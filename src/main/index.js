const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const ZaloManager = require('./zaloManager');
const BubbleWindowManager = require('./bubbleWindow');
const { fetchLinkPreview, safeHttpUrl } = require('./linkPreview');
const AccountRegistry = require('./accountRegistry');
const { requestQuickLock } = require('./quickLock');
const FileDownloads = require('./fileDownloads');
const { HostedSessionBridge } = require('./hostedSessionBridge');
const { createWebServer } = require('../web/server');
const { autoUpdater } = require('electron-updater');
const { createAppUpdates } = require('./appUpdates');

let dashboardWindow = null;
let bubbleManager = null;
let zaloManager = null;
let tray = null;
let accountRegistry = null;
let activeAccount = null;
let activeAccountDir = null;
let fileDownloads = null;
let webHostServer = null;
let appUpdates = null;
const WEB_HOST_URL = 'http://127.0.0.1:3177';
let pickerWindow = null;
const WEB_ACCOUNT_ORIGIN = 'https://zalo.ngochoangit.net';

function chooseAccount() {
  return new Promise(resolve => {
    let resolved = false;
    pickerWindow = new BrowserWindow({
      width: 560, height: 650, minWidth: 480, minHeight: 520,
      title: 'Chọn tài khoản Zalo', icon: path.join(__dirname, '../assets/logo.png'),
      backgroundColor: '#0b1220', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'accountPreload.js'),
        nodeIntegration: false, contextIsolation: true }
    });
    pickerWindow.loadFile(path.join(__dirname, '../renderer/account/index.html'));
    pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const fromPicker = event => !resolved && pickerWindow && !pickerWindow.isDestroyed() &&
      event.sender === pickerWindow.webContents;
    const finish = account => {
      if (resolved) return;
      resolved = true;
      pickerWindow.hide();
      resolve(account);
    };
    const failures = new Map();
    let webLoginBusy = false;
    ipcMain.handle('account-list', event => {
      if (!fromPicker(event)) throw new Error('Cửa sổ chọn tài khoản không còn hoạt động');
      return accountRegistry.list();
    });
    ipcMain.handle('account-create', (event, name, password) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      try {
        const account = accountRegistry.create(name, password);
        finish(account);
        return { success: true };
      } catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle('account-unlock', (event, id, password) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      const attempt = failures.get(id) || { count: 0, until: 0 };
      if (Date.now() < attempt.until) return { success: false, error: 'Thử lại sau 30 giây' };
      try {
        const entry = accountRegistry.list().find(account => account.id === id);
        if (!entry) throw new Error('Không tìm thấy tài khoản');
        const account = entry.needsPassword
          ? (password ? accountRegistry.setInitialPassword(id, password)
            : accountRegistry.openWithoutPassword(id))
          : accountRegistry.verify(id, password);
        if (!account) {
          attempt.count += 1;
          if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 30000; }
          failures.set(id, attempt);
          throw new Error('Mật khẩu không đúng');
        }
        const record = accountRegistry.accounts.find(item => item.id === id);
        accountRegistry.migrateLegacy(record);
        failures.delete(id);
        finish(account);
        return { success: true };
      } catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle('account-set-password', (event, id, password) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      try {
        const entry = accountRegistry.list().find(account => account.id === id);
        if (!entry || entry.requiresPassword || entry.needsPassword) {
          throw new Error('Tài khoản không thể đặt mật khẩu theo cách này');
        }
        if (!accountRegistry.changePassword(id, '', password)) throw new Error('Không thể đặt mật khẩu');
        return { success: true };
      } catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle('account-remove', (event, id, password) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      try {
        accountRegistry.remove(id, password);
        failures.delete(id);
        return { success: true };
      } catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle('account-web-login', async (event, username, password, accountId) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      if (webLoginBusy) return { success: false, error: 'Đang xử lý đăng nhập web' };
      webLoginBusy = true;
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Máy chưa hỗ trợ mã hóa khóa đăng nhập web');
        const result = await HostedSessionBridge.login(WEB_ACCOUNT_ORIGIN, username, password, accountId);
        if (result.accounts) return { success: true, accounts: result.accounts };
        const { account: remote, bridge } = result;
        const hostedSession = await bridge.download();
        const remoteUserId = String(hostedSession?.userInfo?.userId || '');
        const account = accountRegistry.findOrCreateHosted(bridge.origin, remote.id, remote.label, remoteUserId, safeStorage);
        HostedSessionBridge.save(accountRegistry.dataDir(account.id), bridge.origin, bridge.token);
        finish(account);
        return { success: true, account: { id: remote.id, label: remote.label } };
      } catch (error) { return { success: false, error: error.message }; }
      finally { webLoginBusy = false; }
    });
    ipcMain.handle('account-web-register', async (event, username, password) => {
      if (!fromPicker(event)) return { success: false, error: 'Cửa sổ không hợp lệ' };
      try {
        const result = await HostedSessionBridge.register(WEB_ACCOUNT_ORIGIN, username, password);
        return { success: true, message: result.message };
      } catch (error) { return { success: false, error: error.message }; }
    });
  });
}

// Ngăn ngừa crash do unhandled exceptions hoặc WebSocket network dropped
process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Main] Bắt được uncaughtException (đã ngăn ngừa crash):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Main] Bắt được unhandledRejection:', reason);
});

// Giới hạn chạy một instance duy nhất (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Ứng dụng NHITZalo đã đang chạy. Đang kích hoạt cửa sổ hiện tại...');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    showAndFocusDashboard();
    if (bubbleManager && bubbleManager.window) {
      bubbleManager.window.show();
      bubbleManager.window.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

function showAndFocusDashboard() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    createDashboardWindow();
    return;
  }
  if (dashboardWindow.isMinimized()) {
    dashboardWindow.restore();
  }
  dashboardWindow.center();
  dashboardWindow.show();
  dashboardWindow.setAlwaysOnTop(true);
  dashboardWindow.focus();
  dashboardWindow.setAlwaysOnTop(false);
  dashboardWindow.moveTop();
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    showAndFocusDashboard();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    center: true,
    title: 'NgocHoangIT - Zalo Bubble Notifier',
    icon: path.join(__dirname, '../assets/logo.png'),
    frame: false,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  dashboardWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Line ${line}] ${message}`);
  });

  dashboardWindow.loadFile(path.join(__dirname, '../renderer/dashboard/index.html'), {
    query: { accountId: activeAccount.id, legacy: activeAccount.originLegacy ? '1' : '0' }
  });

  dashboardWindow.once('ready-to-show', () => {
    showAndFocusDashboard();
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/logo.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 20, height: 20 });
  }

  tray = new Tray(icon);
  tray.setToolTip('NgocHoangIT - Zalo Bubble Notifier');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mở Bảng điều khiển',
      click: () => showAndFocusDashboard()
    },
    {
      label: 'Đặt lại vị trí Bong bóng tròn',
      click: () => {
        if (bubbleManager) bubbleManager.resetPosition();
      }
    },
    {
      label: 'Bật / Ẩn Bong bóng tròn',
      click: () => {
        if (bubbleManager && bubbleManager.window) {
          if (bubbleManager.window.isVisible()) {
            bubbleManager.window.hide();
          } else {
            bubbleManager.window.show();
            bubbleManager.window.setAlwaysOnTop(true, 'screen-saver');
          }
        }
      }
    },
    {
      label: 'Khóa nhanh tài khoản',
      click: () => {
        const result = requestQuickLock(activeAccount, () => setTimeout(() => {
          app.relaunch(); app.exit(0);
        }, 100));
        if (!result.success) {
          showAndFocusDashboard();
          dashboardWindow?.webContents.send('account-lock-needs-password');
        }
      }
    },
    {
      label: 'Kiểm tra cập nhật',
      click: () => appUpdates?.check({ manual: true })
    },
    { type: 'separator' },
    {
      label: 'Thoát ứng dụng',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => showAndFocusDashboard());
  tray.on('click', () => showAndFocusDashboard());
}

app.whenReady().then(async () => {
  appUpdates = createAppUpdates({ app, dialog, updater: autoUpdater,
    getWindow: () => dashboardWindow });
  setTimeout(() => appUpdates.check(), 5000);
  setInterval(() => appUpdates.check(), 4 * 60 * 60 * 1000);
  accountRegistry = new AccountRegistry(app.getPath('userData'));
  const mergedProfiles = accountRegistry.consolidateSameZaloProfiles(safeStorage);
  if (mergedProfiles) console.log(`Đã gộp ${mergedProfiles} hồ sơ dùng chung tài khoản Zalo.`);
  accountRegistry.refreshZaloNames(safeStorage);
  activeAccount = await chooseAccount();
  activeAccountDir = accountRegistry.dataDir(activeAccount.id);
  fileDownloads = new FileDownloads(activeAccountDir, app.getPath('downloads'));

  // 1. Tạo Bubble Window Manager và hiển thị bong bóng nổi
  bubbleManager = new BubbleWindowManager(activeAccountDir, activeAccount);
  bubbleManager.createWindow();

  // 2. Tạo Dashboard Window
  createDashboardWindow();

  // 3. Tạo System Tray
  createTray();
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.destroy();

  // 4. Khởi tạo Zalo Manager
  zaloManager = new ZaloManager(
    (statusData) => {
      if (statusData.status === 'connected' && statusData.user?.name) {
        const updated = accountRegistry.setZaloName(activeAccount.id, statusData.user.name);
        if (updated) activeAccount = updated;
      }
      // Gửi cập nhật trạng thái Zalo đến Dashboard
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-status-change', statusData);
        dashboardWindow.webContents.send('account-name-updated', activeAccount.name);
      }
    },
    (message, isOld = false) => {
      // Nhận tin nhắn thực tế từ Zalo (cả mới và cũ)
      if (bubbleManager) {
        bubbleManager.showNewMessage(message, isOld);
      }
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-new-message', message, isOld);
      }
      fileDownloads.onMessage(message, isOld).then(result => {
        if (result && dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.webContents.send('zalo-file-download-result', { url: message.fileUrl, ...result });
        }
      }).catch(error => console.warn('Không thể tự tải tệp Zalo:', error.message));
    },
    (syncStatusData) => {
      // Gửi trạng thái đồng bộ chi tiết (chờ điện thoại, xác nhận, hoàn tất) đến Dashboard
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-sync-status', syncStatusData);
      }
    },
    (undoData) => {
      // Nhận sự kiện thu hồi tin nhắn (từ chính mình hoặc người khác)
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-message-undo', undoData);
      }
      if (bubbleManager && typeof bubbleManager.handleMessageUndo === 'function') {
        bubbleManager.handleMessageUndo(undoData);
      }
    },
    (reactionData) => {
      // Nhận sự kiện reaction cập nhật (từ chính mình hoặc người khác)
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-message-reaction', reactionData);
      }
      if (bubbleManager && typeof bubbleManager.handleMessageReaction === 'function') {
        bubbleManager.handleMessageReaction(reactionData);
      }
    },
    (captionData) => {
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-photo-caption-updated', captionData);
      }
      if (bubbleManager?.window && !bubbleManager.window.isDestroyed()) {
        bubbleManager.window.webContents.send('zalo-photo-caption-updated', captionData);
      }
    },
    activeAccountDir,
    status => {
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-delivery-status', status);
      }
      if (bubbleManager?.window && !bubbleManager.window.isDestroyed()) {
        bubbleManager.window.webContents.send('zalo-delivery-status', status);
      }
    }
  );
  zaloManager.requestStartupQuickSync();
  zaloManager.hostedSessionBridge = HostedSessionBridge.load(activeAccountDir);

  // Tự động kiểm tra phiên đăng nhập đã lưu
  setTimeout(async () => {
    const hasSession = zaloManager.hasSavedSession() || Boolean(zaloManager.hostedSessionBridge);
    if (hasSession) {
      console.log('Phát hiện session Zalo, tự động đăng nhập...');
      await zaloManager.tryAutoLogin();
    }
  }, 1500);

  // Cấu hình IPC Handlers
  ipcMain.handle('account-current', () => activeAccount);
  const getHostedConnectionStatus = async () => {
    const bridge = zaloManager?.hostedSessionBridge;
    if (!bridge) return { phase: 'disconnected', paired: false, connected: false, origin: '' };
    try {
      const account = await bridge.status();
      return { phase: 'connected', paired: true, connected: true, origin: bridge.origin,
        accountLabel: account.label || '', hasSession: Boolean(account.has_session) };
    } catch (error) {
      return { phase: error.status === 401 || error.status === 403 ? 'auth-error' : 'offline',
        paired: true, connected: false, origin: bridge.origin, error: error.message };
    }
  };
  ipcMain.handle('hosted-session-status', async event => {
    if (event.sender !== dashboardWindow?.webContents) return { phase: 'disconnected', paired: false, connected: false };
    return getHostedConnectionStatus();
  });
  ipcMain.handle('hosted-session-check', async (event, origin) => {
    if (event.sender !== dashboardWindow?.webContents) return { phase: 'error', error: 'Cửa sổ không hợp lệ' };
    const bridge = zaloManager?.hostedSessionBridge;
    if (bridge && (!origin || origin.trim().replace(/\/$/, '') === bridge.origin)) return getHostedConnectionStatus();
    try {
      const health = await HostedSessionBridge.checkOrigin(origin);
      return { phase: 'ready', paired: false, connected: false, origin: health.origin,
        message: 'PHP và MySQL hoạt động. Nhập mã ghép nối để kết nối.' };
    } catch (error) { return { phase: 'error', paired: false, connected: false, origin: String(origin || ''), error: error.message }; }
  });
  ipcMain.handle('hosted-session-pair', async (event, origin, code) => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false, error: 'Cửa sổ không hợp lệ' };
    try {
      await HostedSessionBridge.checkOrigin(origin);
      const bridge = await HostedSessionBridge.pair(origin, code);
      const account = await bridge.status();
      const local = zaloManager.loadSession();
      const remote = await bridge.download();
      if (local && remote) {
        const localUid = String(local.userInfo?.userId || '');
        const remoteUid = String(remote.userInfo?.userId || '');
        if (localUid && remoteUid && localUid !== remoteUid) {
          await bridge.revoke();
          throw new Error('Tài khoản Zalo trên hosting khác với tài khoản đang mở trong Electron');
        }
      }
      if (!remote && local?.imei && local?.cookie) await bridge.upload(local);
      HostedSessionBridge.save(activeAccountDir, bridge.origin, bridge.token);
      const previousBridge = zaloManager.hostedSessionBridge;
      zaloManager.hostedSessionBridge = bridge;
      if (previousBridge && previousBridge.token !== bridge.token) previousBridge.revoke()
        .catch(error => console.warn('Không thể thu hồi mã thiết bị cũ:', error.message));
      if (remote?.imei && remote?.cookie) {
        if (!zaloManager.api) zaloManager.tryAutoLogin().catch(error => console.warn('Không thể đăng nhập phiên hosting:', error.message));
      }
      return { success: true, origin: bridge.origin, accountLabel: account.label || '',
        hasSession: Boolean(remote?.imei && remote?.cookie) || Boolean(local?.imei && local?.cookie) };
    } catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('hosted-session-unpair', async event => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false };
    try { await zaloManager.hostedSessionBridge?.revoke(); }
    catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        return { success: false, error: `Không thu hồi được quyền thiết bị: ${error.message}` };
      }
    }
    try { fs.unlinkSync(path.join(activeAccountDir, 'hosted_session_bridge.json')); }
    catch (error) { if (error.code !== 'ENOENT') return { success: false, error: `Không xóa được ghép nối trên máy: ${error.message}` }; }
    zaloManager.hostedSessionBridge = null;
    return { success: true };
  });
  ipcMain.handle('account-change-password', (event, currentPassword, newPassword) => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false, error: 'Cửa sổ không hợp lệ' };
    try {
      const success = accountRegistry.changePassword(activeAccount.id, currentPassword, newPassword);
      if (success) activeAccount = accountRegistry.list().find(item => item.id === activeAccount.id);
      return success ? { success: true, requiresPassword: activeAccount.requiresPassword }
        : { success: false, error: 'Mật khẩu hiện tại không đúng' };
    } catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('account-switch', event => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false };
    setTimeout(() => { app.relaunch(); app.exit(0); }, 100);
    return { success: true };
  });
  ipcMain.handle('account-lock', event => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false, error: 'Cửa sổ không hợp lệ' };
    return requestQuickLock(activeAccount, () => setTimeout(() => {
      app.relaunch(); app.exit(0);
    }, 100));
  });

  ipcMain.handle('web-host-status', event => {
    if (event.sender !== dashboardWindow?.webContents) return { running: false };
    return { running: Boolean(webHostServer?.listening), url: WEB_HOST_URL };
  });
  ipcMain.handle('web-host-start', async (event, password) => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false, error: 'Cửa sổ không hợp lệ' };
    if (webHostServer?.listening) return { success: true, url: WEB_HOST_URL };
    try {
      const server = createWebServer({ dataDir: path.join(app.getPath('userData'), 'web-host'),
        password, publicOrigin: WEB_HOST_URL });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(3177, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      webHostServer = server;
      server.zaloSessions.resumeAll().catch(error => console.warn('Lỗi khôi phục phiên web:', error.message));
      return { success: true, url: WEB_HOST_URL };
    } catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('web-host-stop', async event => {
    if (event.sender !== dashboardWindow?.webContents) return { success: false };
    if (webHostServer?.listening) {
      const server = webHostServer;
      webHostServer = null;
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    }
    return { success: true };
  });
  ipcMain.handle('web-host-open', async event => {
    if (event.sender !== dashboardWindow?.webContents || !webHostServer?.listening) return { success: false };
    await shell.openExternal(WEB_HOST_URL);
    return { success: true };
  });

  ipcMain.handle('zalo-sync-old-messages', async () => {
    try {
      return await zaloManager.syncOldMessages();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-quick-sync-messages', async () => {
    if (!zaloManager) return { success: false, error: 'Chưa khởi tạo Zalo' };
    return await zaloManager.quickSyncMessages();
  });

  ipcMain.handle('zalo-get-sync-status', () => {
    return zaloManager ? zaloManager.getSyncStatus() : null;
  });

  ipcMain.handle('open-data-folder', () => {
    const userData = activeAccountDir;
    shell.openPath(userData);
    return { success: true, path: userData };
  });

  ipcMain.handle('zalo-get-history-messages', () => {
    return zaloManager ? zaloManager.getHistoryMessages() : [];
  });

  ipcMain.handle('zalo-get-conversation-heads', () => {
    return zaloManager ? zaloManager.getConversationHeads() : [];
  });

  ipcMain.handle('zalo-get-my-cloud-id', () => {
    return zaloManager ? zaloManager.getMyCloudId() : '';
  });

  ipcMain.handle('zalo-fetch-cloud-messages', async (event, { cursor = '0', older = false } = {}) => {
    if (!zaloManager) throw new Error('Chưa khởi tạo Zalo');
    return zaloManager.fetchCloudMessages(cursor, older);
  });

  ipcMain.handle('zalo-get-bubble-startup', () => {
    return zaloManager ? zaloManager.getBubbleStartupMessages() : [];
  });

  ipcMain.handle('zalo-get-thread-history', (event, { threadId, limit, offset }) => {
    return zaloManager ? zaloManager.getThreadHistory(threadId, limit, offset) : [];
  });

  const linkPreviewCache = new Map();
  ipcMain.handle('zalo-get-link-preview', async (event, value) => {
    const url = safeHttpUrl(value);
    if (!url) return null;
    if (!linkPreviewCache.has(url)) {
      const promise = fetchLinkPreview(url).catch(() => null);
      linkPreviewCache.set(url, promise);
      if (linkPreviewCache.size > 500) linkPreviewCache.delete(linkPreviewCache.keys().next().value);
    }
    return linkPreviewCache.get(url);
  });
  ipcMain.handle('zalo-open-external-link', async (event, value) => {
    const url = safeHttpUrl(value);
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('zalo-resolve-group-senders', (event, { threadId, senderIds }) => {
    return zaloManager ? zaloManager.resolveGroupSenderNames(threadId, senderIds) : [];
  });

  ipcMain.handle('zalo-search-history', (event, { query, limit, offset }) => {
    return zaloManager ? zaloManager.searchHistoryMessages(query, limit, offset) : [];
  });

  ipcMain.handle('zalo-clear-history-messages', () => {
    return zaloManager ? zaloManager.clearHistoryMessages() : true;
  });

  ipcMain.handle('zalo-get-groups', () => {
    return zaloManager ? zaloManager.getGroupsList() : [];
  });

  ipcMain.handle('zalo-fetch-groups', async () => {
    return zaloManager ? await zaloManager.fetchGroupsList() : [];
  });

  ipcMain.handle('zalo-fetch-thread-messages', async (event, { threadId, isGroup }) => {
    if (!zaloManager) return [];
    try {
      return await zaloManager.fetchThreadMessages(threadId, isGroup);
    } catch (e) {
      console.warn('Lỗi fetchThreadMessages:', e.message);
      return [];
    }
  });

  // Đánh dấu hội thoại đã đọc (đồng bộ 2 chiều giữa Bong bóng và Dashboard)
  ipcMain.handle('zalo-mark-thread-read', (event, threadId) => {
    if (!threadId || !zaloManager) return { success: false };
    const res = zaloManager.markThreadAsRead(threadId);

    // Xóa tin chưa đọc trong bộ nhớ bubbleManager nếu có
    if (bubbleManager) {
      bubbleManager.markThreadRead(threadId);
    }

    // Phát sự kiện sang Dashboard Window
    if (dashboardWindow && !dashboardWindow.isDestroyed() && dashboardWindow.webContents) {
      dashboardWindow.webContents.send('thread-marked-as-read', res);
    }

    // Phát sự kiện sang Bubble Window
    if (bubbleManager && bubbleManager.window && !bubbleManager.window.isDestroyed() && bubbleManager.window.webContents) {
      bubbleManager.window.webContents.send('thread-marked-as-read', res);
    }

    return { success: true, ...res };
  });

  // Lấy toàn bộ danh sách mốc thời gian đã đọc
  ipcMain.handle('zalo-get-read-threads', () => {
    return zaloManager ? zaloManager.getReadThreads() : {};
  });

  ipcMain.handle('zalo-login-qr', async () => {
    try {
      return await zaloManager.startLoginQR();
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-logout', async () => {
    return zaloManager.clearSession();
  });

  ipcMain.handle('zalo-check-session', () => {
    return {
      hasSession: zaloManager.hasSavedSession() || Boolean(zaloManager.hostedSessionBridge),
      currentUser: zaloManager.currentUser
    };
  });

  ipcMain.handle('zalo-auto-login', async () => {
    return await zaloManager.tryAutoLogin();
  });

  ipcMain.handle('zalo-send-reply', async (event, { threadId, content, isGroup, quote, attachments }) => {
    try {
      return await zaloManager.sendReply(threadId, content, isGroup, quote, attachments);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-forward-text', async (event, { message, threadId, isGroup }) => {
    return zaloManager.forwardTextMessage(message, threadId, isGroup);
  });

  ipcMain.handle('zalo-send-sticker', async (event, { threadId, sticker, isGroup }) => {
    try {
      return await zaloManager.sendSticker(threadId, sticker, isGroup);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-get-stickers', async (event, keyword) => {
    try {
      return zaloManager ? await zaloManager.getStickers(keyword) : [];
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('zalo-get-stickers-detail', async (event, stickerIds) => {
    try {
      return zaloManager ? await zaloManager.getStickersDetail(stickerIds) : [];
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('zalo-send-reaction', async (event, { threadId, msgId, cliMsgId, icon, isGroup }) => {
    try {
      return await zaloManager.sendReaction(threadId, msgId, cliMsgId, icon, isGroup);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-undo-message', async (event, { threadId, msgId, cliMsgId, isGroup }) => {
    try {
      return await zaloManager.undoMessage(threadId, msgId, cliMsgId, isGroup);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-set-pinned', async (event, { threadId, isPinned, isGroup }) => {
    try {
      return await zaloManager.setPinnedConversation(threadId, isPinned, isGroup);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-get-pinned', async () => {
    return zaloManager ? await zaloManager.fetchPinnedThreads() : [];
  });

  ipcMain.handle('zalo-get-muted-threads', async () => {
    return zaloManager ? zaloManager.getMutedThreads() : {};
  });

  ipcMain.handle('zalo-fetch-muted-threads', async () => {
    return zaloManager ? await zaloManager.fetchMuteList() : {};
  });

  ipcMain.handle('zalo-is-thread-muted', (event, threadId) => {
    return zaloManager ? zaloManager.isThreadMuted(threadId) : false;
  });

  ipcMain.handle('zalo-set-thread-mute', async (event, { threadId, isMuted, isGroup, duration }) => {
    try {
      const res = await zaloManager.setThreadMute(threadId, isMuted, isGroup, duration);
      if (res.success && bubbleManager && typeof bubbleManager.onThreadMuteChanged === 'function') {
        bubbleManager.onThreadMuteChanged(threadId, isMuted);
      }
      return res;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-get-friends', async () => {
    return zaloManager ? zaloManager.getFriendsList() : [];
  });

  ipcMain.handle('open-contact-chat', async (event, contact) => {
    if (event.sender !== dashboardWindow?.webContents &&
        event.sender !== bubbleManager?.window?.webContents) return { success: false };
    const uid = String(contact?.uid || '');
    if (!/^\d{7,25}$/.test(uid)) return { success: false, error: 'ID người dùng không hợp lệ' };
    const name = String(contact?.name || '').slice(0, 100);
    const needsLoad = !dashboardWindow || dashboardWindow.isDestroyed();
    showAndFocusDashboard();
    if (needsLoad) {
      dashboardWindow.webContents.once('did-finish-load', () => {
        dashboardWindow?.webContents.send('open-contact-chat', { uid, name });
      });
    } else dashboardWindow.webContents.send('open-contact-chat', { uid, name });
    return { success: true };
  });

  ipcMain.handle('zalo-fetch-friends', async () => {
    return zaloManager ? await zaloManager.fetchFriendsList() : [];
  });

  ipcMain.handle('zalo-get-group-details', async (event, groupId) => {
    try {
      return await zaloManager.getGroupDetails(groupId);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-get-conversation-tools', async (event, { threadId, isGroup }) => {
    return zaloManager.getConversationTools(threadId, isGroup);
  });

  ipcMain.handle('zalo-create-poll', async (event, { groupId, options }) => {
    try {
      return await zaloManager.createGroupPoll(groupId, options);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalo-create-reminder', async (event, { threadId, options, isGroup }) => {
    try {
      return await zaloManager.createGroupReminder(threadId, options, isGroup);
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('choose-file', async () => {
    if (!dashboardWindow) return null;
    const result = await dialog.showOpenDialog(dashboardWindow, {
      title: 'Chọn ảnh hoặc tệp tin để gửi qua Zalo',
      properties: ['openFile'],
      filters: [
        { name: 'Tất cả tệp hỗ trợ', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'rar', 'txt', 'mp4'] },
        { name: 'Hình ảnh (*.jpg, *.png, *.webp)', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
        { name: 'Tài liệu (*.pdf, *.docx, *.xlsx)', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'zip', 'rar'] },
        { name: 'Tất cả tệp (*.*)', extensions: ['*'] }
      ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Lưu ảnh chụp màn hình từ Clipboard vào thư mục tạm thời để gửi đi
  ipcMain.handle('save-clipboard-image', async (event, base64Data) => {
    if (event.sender !== dashboardWindow?.webContents &&
        event.sender !== bubbleManager?.window?.webContents) throw new Error('Cửa sổ không hợp lệ');
    if (base64Data && (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(base64Data) || base64Data.length > 35_000_000)) {
      throw new Error('Dữ liệu ảnh clipboard không hợp lệ hoặc quá lớn');
    }
    const image = base64Data ? nativeImage.createFromDataURL(base64Data) : clipboard.readImage();
    if (image.isEmpty()) throw new Error('Clipboard không chứa ảnh hợp lệ');
    const buffer = image.toPNG();
    if (buffer.length > 25_000_000) throw new Error('Ảnh clipboard vượt quá 25 MB');
    const tempDir = path.join(activeAccountDir, 'temp_attachments');
    fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `clipboard_img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  });

  ipcMain.on('bubble-reset-position', () => {
    if (bubbleManager) bubbleManager.resetPosition();
  });

  ipcMain.on('bubble-toggle-visibility', (event, visible) => {
    if (bubbleManager && bubbleManager.window) {
      if (visible) bubbleManager.window.show();
      else bubbleManager.window.hide();
    }
  });

  ipcMain.handle('zalo-file-download-settings', () => fileDownloads.getSettings());
  ipcMain.handle('zalo-file-download-set-settings', (event, changes) => fileDownloads.setSettings(changes));
  ipcMain.handle('zalo-file-download-choose-directory', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
      title: 'Chọn thư mục lưu tệp Zalo', properties: ['openDirectory'],
      defaultPath: fileDownloads.getSettings().directory
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return fileDownloads.setSettings({ directory: result.filePaths[0] });
  });
  ipcMain.handle('zalo-file-lookup', (event, items) => fileDownloads.lookup(items));

  // Tải tệp tin về máy tính
  ipcMain.handle('zalo-download-file', async (event, { fileUrl, fileName, promptSaveAs, fileSize }) => {
    try {
      if (!fileUrl) throw new Error('Không có đường dẫn tệp tin');
      let targetPath;
      if (promptSaveAs) {
        const safeName = fileDownloads.safeName(fileName, fileUrl);
        const ext = path.extname(safeName).slice(1);
        const result = await dialog.showSaveDialog(dashboardWindow || null, {
          title: 'Lưu tệp tin về máy tính',
          defaultPath: path.join(fileDownloads.getSettings().directory, safeName),
          filters: ext ? [{ name: ext.toUpperCase() + ' File', extensions: [ext] }, { name: 'Tất cả tệp', extensions: ['*'] }] : [{ name: 'Tất cả tệp', extensions: ['*'] }]
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        targetPath = result.filePath;
      }
      const result = await fileDownloads.download(fileUrl, fileName, { targetPath, fileSize });
      if (result.success && dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('zalo-file-download-result', { url: fileUrl, ...result });
      }
      return result;
    } catch (err) {
      console.error('Lỗi tải tệp tin:', err);
      return { success: false, error: err.message };
    }
  });

  // Mở tệp tin bằng ứng dụng mặc định
  ipcMain.handle('open-file-path', async (event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        await shell.openPath(filePath);
        return { success: true };
      }
      return { success: false, error: 'Tệp không tồn tại' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Mở thư mục chứa tệp tin (Show in folder)
  ipcMain.handle('show-item-in-folder', (event, filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
      return { success: false, error: 'Tệp không tồn tại' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('open-dashboard', () => {
    showAndFocusDashboard();
  });

  ipcMain.on('minimize-window', () => {
    if (dashboardWindow) dashboardWindow.minimize();
  });

  // Khi đóng Dashboard: Thoát ứng dụng hoàn toàn, TUYỆT ĐỐI KHÔNG CHẠY NGẦM
  ipcMain.on('close-dashboard', () => {
    if (bubbleManager) {
      try { bubbleManager.destroy(); } catch (e) {}
    }
    app.quit();
  });
});

// Khi đóng tất cả cửa sổ: Thoát ứng dụng hoàn toàn, TUYỆT ĐỐI KHÔNG CHẠY NGẦM
app.on('window-all-closed', () => {
  if (bubbleManager) {
    try { bubbleManager.destroy(); } catch (e) {}
  }
  app.quit();
});
