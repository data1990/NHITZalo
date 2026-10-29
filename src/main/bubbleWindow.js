const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { countIncomingMessages } = require('../shared/unreadMessages');

class BubbleWindowManager {
  constructor(accountDataDir, account) {
    this.window = null;
    this.isExpanded = false;
    this.collapsedSize = { width: 84, height: 84 };
    this.expandedSize = { width: 440, height: 530 };
    this.previewSize = { width: 384, height: 92 };
    this.positionConfigPath = path.join(accountDataDir || app.getPath('userData'), 'bubble_pos.json');
    this.account = account || null;
    this.position = this.loadPosition();
    this.unreadMessages = [];
    this.isPreviewing = false;
    this.previewTimeout = null;
    this.currentAlign = 'right';
  }

  loadPosition() {
    try {
      if (fs.existsSync(this.positionConfigPath)) {
        return JSON.parse(fs.readFileSync(this.positionConfigPath, 'utf8'));
      }
    } catch (e) {
      console.warn('Lỗi đọc vị trí bubble:', e.message);
    }
    return null; // Mặc định tính theo góc phải màn hình
  }

  savePosition(x, y) {
    try {
      this.position = { x, y };
      fs.writeFileSync(this.positionConfigPath, JSON.stringify({ x, y }), 'utf8');
    } catch (e) {
      console.warn('Lỗi lưu vị trí bubble:', e.message);
    }
  }

  createWindow() {
    if (this.window) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    let posX = this.position ? this.position.x : screenWidth - this.collapsedSize.width - 24;
    let posY = this.position ? this.position.y : screenHeight - this.collapsedSize.height - 100;

    // Đảm bảo không nằm ngoài màn hình
    posX = Math.max(10, Math.min(posX, screenWidth - this.collapsedSize.width - 10));
    posY = Math.max(10, Math.min(posY, screenHeight - this.collapsedSize.height - 10));

    this.window = new BrowserWindow({
      width: this.collapsedSize.width,
      height: this.collapsedSize.height,
      x: posX,
      y: posY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      icon: path.join(__dirname, '../assets/logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Luôn nổi trên mọi app khác
    this.window.setAlwaysOnTop(true, 'screen-saver');

    this.window.loadFile(path.join(__dirname, '../renderer/bubble/index.html'), {
      query: { accountId: this.account?.id || '', legacy: this.account?.originLegacy ? '1' : '0' }
    });

    this.window.once('ready-to-show', () => {
      if (this.window) {
        this.window.show();
        this.window.setAlwaysOnTop(true, 'screen-saver');
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    // Bắt đầu di chuyển qua IPC để di chuột mượt mà
    ipcMain.on('bubble-drag-move', (event, { deltaX, deltaY }) => {
      if (!this.window) return;
      if (this.isPreviewing) {
        this.hidePreview();
      }
      const [curX, curY] = this.window.getPosition();
      const newX = curX + deltaX;
      const newY = curY + deltaY;
      this.window.setPosition(newX, newY);
    });

    ipcMain.on('bubble-drag-end', () => {
      if (!this.window) return;
      const [x, y] = this.window.getPosition();
      this.savePosition(x, y);
    });

    ipcMain.on('bubble-expand', () => {
      this.expand();
    });

    ipcMain.on('bubble-collapse', () => {
      this.collapse();
    });

    ipcMain.on('bubble-hide-preview', () => {
      this.hidePreview();
    });
  }

  showPreview(message) {
    if (!this.window || this.window.isDestroyed() || this.isExpanded) return;

    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
      this.previewTimeout = null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Lấy vị trí gốc của bong bóng tròn (84x84)
    let posX = this.position ? this.position.x : screenWidth - this.collapsedSize.width - 24;
    let posY = this.position ? this.position.y : screenHeight - this.collapsedSize.height - 100;

    // Nếu đang không preview, đọc vị trí hiện tại từ window
    if (!this.isPreviewing) {
      const [curX, curY] = this.window.getPosition();
      posX = curX;
      posY = curY;
      this.position = { x: posX, y: posY };
    }

    // Xác định xem bong bóng đang ở nửa bên phải hay nửa bên trái màn hình
    const isRightSide = (posX + this.collapsedSize.width / 2) > (screenWidth / 2);
    this.currentAlign = isRightSide ? 'right' : 'left';

    let winX = posX;
    let winY = posY;

    if (isRightSide) {
      // Bong bóng ở bên phải, preview nở sang bên trái
      winX = posX - (this.previewSize.width - this.collapsedSize.width);
    } else {
      // Bong bóng ở bên trái, preview nở sang bên phải
      winX = posX;
    }

    // Đảm bảo không tràn màn hình
    winX = Math.max(10, Math.min(winX, screenWidth - this.previewSize.width - 10));
    winY = Math.max(10, Math.min(winY, screenHeight - this.previewSize.height - 10));

    this.isPreviewing = true;
    this.window.setBounds({
      x: Math.round(winX),
      y: Math.round(winY),
      width: this.previewSize.width,
      height: this.previewSize.height
    });

    this.window.webContents.send('bubble-show-preview', {
      message,
      align: this.currentAlign
    });

    // Tự động thu gọn preview sau 7.5 giây nếu người dùng không tương tác
    this.previewTimeout = setTimeout(() => {
      this.hidePreview();
    }, 7500);
  }

  hidePreview() {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
      this.previewTimeout = null;
    }

    if (!this.isPreviewing || !this.window || this.window.isDestroyed() || this.isExpanded) {
      this.isPreviewing = false;
      return;
    }

    this.isPreviewing = false;

    // Đưa cửa sổ về vị trí tròn ban đầu (84x84)
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    let posX = this.position ? this.position.x : screenWidth - this.collapsedSize.width - 24;
    let posY = this.position ? this.position.y : screenHeight - this.collapsedSize.height - 100;

    posX = Math.max(10, Math.min(posX, screenWidth - this.collapsedSize.width - 10));
    posY = Math.max(10, Math.min(posY, screenHeight - this.collapsedSize.height - 10));

    this.window.setBounds({
      x: Math.round(posX),
      y: Math.round(posY),
      width: this.collapsedSize.width,
      height: this.collapsedSize.height
    });

    this.window.webContents.send('bubble-preview-hidden');
  }

  expand() {
    if (!this.window || this.isExpanded) return;

    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
      this.previewTimeout = null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Nếu đang ở chế độ preview, vị trí gốc của bong bóng tròn là this.position
    let currentX, currentY;
    if (this.isPreviewing && this.position) {
      currentX = this.position.x;
      currentY = this.position.y;
    } else {
      [currentX, currentY] = this.window.getPosition();
    }

    this.isPreviewing = false;
    this.isExpanded = true;

    // Khi mở rộng, nở về phía trên-trái nếu ở góc phải màn hình
    let newX = currentX - (this.expandedSize.width - this.collapsedSize.width);
    let newY = currentY - (this.expandedSize.height - this.collapsedSize.height);

    // Đảm bảo nằm trong màn hình
    if (newX < 10) newX = 10;
    if (newY < 10) newY = 10;
    if (newX + this.expandedSize.width > screenWidth) newX = screenWidth - this.expandedSize.width - 10;
    if (newY + this.expandedSize.height > screenHeight) newY = screenHeight - this.expandedSize.height - 10;

    this.window.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: this.expandedSize.width,
      height: this.expandedSize.height
    });

    this.window.webContents.send('bubble-state-changed', { isExpanded: true });
  }

  collapse() {
    if (!this.window || !this.isExpanded) return;
    this.isExpanded = false;
    this.isPreviewing = false;

    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
      this.previewTimeout = null;
    }

    const [currentX, currentY] = this.window.getPosition();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Thu lại về góc ban đầu
    let newX = currentX + (this.expandedSize.width - this.collapsedSize.width);
    let newY = currentY + (this.expandedSize.height - this.collapsedSize.height);

    newX = Math.max(10, Math.min(newX, screenWidth - this.collapsedSize.width - 10));
    newY = Math.max(10, Math.min(newY, screenHeight - this.collapsedSize.height - 10));

    this.window.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: this.collapsedSize.width,
      height: this.collapsedSize.height
    });

    this.savePosition(newX, newY);
    this.window.webContents.send('bubble-state-changed', { isExpanded: false });
  }

  resetPosition() {
    if (!this.window) return;
    if (this.isPreviewing) {
      this.hidePreview();
    }
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const x = screenWidth - this.collapsedSize.width - 24;
    const y = screenHeight - this.collapsedSize.height - 120;
    this.window.setPosition(x, y);
    this.savePosition(x, y);
  }

  showNewMessage(message, isOld = false) {
    try {
      if (!message || message.isConversation || (message.id && message.id.startsWith('conv_'))) return;

      // CHỈ CÓ TIN NHẮN NÀO BẬT THÔNG BÁO MỚI HIỆN LÊN BONG BÓNG:
      // Nếu hội thoại bị tắt thông báo (isMuted), tuyệt đối không hiển thị trên bong bóng chat
      if (message.isMuted) return;

      // Tránh trùng lặp tin nhắn
      const existingIndex = this.unreadMessages.findIndex(m => m.id === message.id);
      if (existingIndex !== -1) {
        this.unreadMessages[existingIndex] = message;
      } else {
        this.unreadMessages.push(message);
      }

      // Sắp xếp theo timestamp giảm dần (mới nhất lên đầu)
      this.unreadMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (this.unreadMessages.length > 50) {
        this.unreadMessages.pop();
      }

      if (!this.window || this.window.isDestroyed()) {
        this.createWindow();
      } else if (!isOld) {
        if (!this.window.isVisible()) this.window.show();
      }

      if (this.window && !this.window.isDestroyed() && this.window.webContents) {
        this.window.webContents.send('new-bubble-message', {
          message,
          isOld: !!isOld,
          unreadCount: countIncomingMessages(this.unreadMessages),
          allMessages: this.unreadMessages
        });

        // Nếu cửa sổ chat đang thu gọn/ẩn và có tin nhắn mới (không phải tin cũ, không phải của chính mình):
        // Kích hoạt hiển thị khung tin nhắn xem trước (message preview pill)
        if (!isOld && !this.isExpanded && message && !message.isSelf) {
          this.showPreview(message);
        }
      }
    } catch (err) {
      console.warn('Lỗi hiển thị bubble message:', err.message);
    }
  }

  handleMessageUndo(undoData) {
    try {
      if (!undoData) return;
      const targetId = String(undoData.msgId || '');
      const targetCli = String(undoData.cliMsgId || '');
      let updated = false;

      for (const m of this.unreadMessages) {
        if ((targetId && (String(m.id) === targetId || String(m.msgId) === targetId)) ||
            (targetCli && String(m.cliMsgId) === targetCli)) {
          m.isUndo = true;
          m.isRevoked = true;
          m.isRecalled = true;
          m.content = 'Tin nhắn đã được thu hồi';
          m.isPhoto = false;
          m.photoUrl = '';
          m.thumbUrl = '';
          m.isVideo = false;
          m.videoUrl = '';
          m.isSticker = false;
          m.stickerUrl = '';
          m.isFile = false;
          m.isLink = false;
          updated = true;
        }
      }

      if (updated && this.window && !this.window.isDestroyed() && this.window.webContents) {
        this.window.webContents.send('new-bubble-message', {
          message: this.unreadMessages[0],
          isOld: true,
          unreadCount: countIncomingMessages(this.unreadMessages),
          allMessages: this.unreadMessages
        });
      }
    } catch (e) {
      console.warn('Lỗi handleMessageUndo trong bubbleWindow:', e.message);
    }
  }

  handleMessageReaction(reactionData) {
    try {
      if (!reactionData) return;
      const targetId = String(reactionData.msgId || '');
      const targetCli = String(reactionData.cliMsgId || '');
      let updated = false;

      for (const m of this.unreadMessages) {
        if ((targetId && (String(m.id) === targetId || String(m.msgId) === targetId)) ||
            (targetCli && String(m.cliMsgId) === targetCli)) {
          m.reactions = reactionData.reactions || [];
          updated = true;
        }
      }

      if (this.window && !this.window.isDestroyed() && this.window.webContents) {
        this.window.webContents.send('zalo-message-reaction', reactionData);
      }
    } catch (e) {
      console.warn('Lỗi handleMessageReaction trong bubbleWindow:', e.message);
    }
  }

  onThreadMuteChanged(threadId, isMuted) {
    if (isMuted) {
      this.unreadMessages = this.unreadMessages.filter(m => String(m.threadId) !== String(threadId));
    }
    if (this.window && !this.window.isDestroyed() && this.window.webContents) {
      this.window.webContents.send('bubble-thread-mute-changed', {
        threadId: String(threadId),
        isMuted: Boolean(isMuted)
      });
    }
  }

  markThreadRead(threadId) {
    if (!threadId) return;
    const cleanId = String(threadId).replace(/^g_/, '');
    this.unreadMessages = (this.unreadMessages || []).filter(m => {
      const mtId = String(m.threadId || '').replace(/^g_/, '');
      return mtId !== cleanId;
    });
  }

  clearUnread() {
    this.unreadMessages = [];
    if (this.window) {
      this.window.webContents.send('clear-unread-count');
    }
  }

  destroy() {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }
}

module.exports = BubbleWindowManager;
