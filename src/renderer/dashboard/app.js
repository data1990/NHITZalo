// =========================================
// STATE & DOM ELEMENTS
// =========================================
let currentTab = 'tab-login';
let unreadMessageCount = 0;
let messagesHistory = [];
let myCloudId = '';
const cloudOlderCursor = new Map();
let cloudRecentRefreshAt = 0;
let cloudRecentRefreshPromise = null;

function refreshCloudRecent() {
  if (!myCloudId || !window.electronAPI?.fetchCloudMessages || cloudRecentRefreshPromise ||
      Date.now() - cloudRecentRefreshAt < 15 * 60_000) return;
  cloudRecentRefreshAt = Date.now();
  cloudRecentRefreshPromise = window.electronAPI.fetchCloudMessages()
    .then(result => {
      for (const message of result.messages || []) addMessageToDashboard(message, true);
      if (result.messages?.length) renderDashboardFeed();
    })
    .catch(error => {
      console.warn('Không làm mới được Cloud của tôi:', error.message);
    })
    .finally(() => { cloudRecentRefreshPromise = null; });
}

async function loadMyCloudId() {
  if (!window.electronAPI?.getMyCloudId) return;
  const id = String(await window.electronAPI.getMyCloudId() || '');
  if (id && id !== myCloudId) {
    myCloudId = id;
    threadHistoryLoaded.clear();
    renderDashboardFeed();
  }
}

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

// Titlebar buttons
const btnWinMinimize = document.getElementById('btn-win-minimize');
const btnWinClose = document.getElementById('btn-win-close');

// Status Card
const statusPulse = document.getElementById('status-pulse');
const statusLabel = document.getElementById('status-label');
const statusDesc = document.getElementById('status-desc');

// QR & Login Elements
const qrBox = document.getElementById('qr-box');
const qrPlaceholder = document.getElementById('qr-placeholder');
const qrImage = document.getElementById('qr-image');
const qrLoading = document.getElementById('qr-loading');
const btnGenerateQR = document.getElementById('btn-generate-qr');

// Account elements
const accountBodyLoggedIn = document.getElementById('account-body-logged-in');
const accountBodyNotLogged = document.getElementById('account-body-not-logged');
const userDisplayName = document.getElementById('user-display-name');
const userAvatarLetter = document.getElementById('user-avatar-letter');
const btnLogout = document.getElementById('btn-logout');

// Messages elements
const dashboardMessagesList = document.getElementById('dashboard-messages-list');
const feedEmpty = document.getElementById('feed-empty');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnTestInTab = document.getElementById('btn-test-in-tab');
const btnQuickTest = document.getElementById('btn-quick-test');
const tabUnreadBadge = document.getElementById('tab-unread-badge');

// Settings elements
const toggleBubbleVisible = document.getElementById('toggle-bubble-visible');
const btnResetBubblePos = document.getElementById('btn-reset-bubble-pos');

// =========================================
// 1. CHUYỂN TABS
// =========================================
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetTab = item.getAttribute('data-tab');
    if (!targetTab) return;

    navItems.forEach(n => n.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    item.classList.add('active');
    const panel = document.getElementById(targetTab);
    if (panel) panel.classList.add('active');

    currentTab = targetTab;

    // Nếu vào tab tin nhắn thì reset badge tab
    if (targetTab === 'tab-messages') {
      unreadMessageCount = 0;
      tabUnreadBadge.classList.add('hidden');
    } else {
      updateDashboardTabUnread();
    }
  });
});

// Titlebar actions
if (btnWinMinimize) {
  btnWinMinimize.addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });
}
if (btnWinClose) {
  btnWinClose.addEventListener('click', () => {
    window.electronAPI.closeDashboard();
  });
}

// =========================================
// 2. TRẠNG THÁI ZALO VÀ ĐĂNG NHẬP
// =========================================
const userAvatarImg = document.getElementById('user-avatar-img');

function updateConnectionUI(status, label, desc, user = null) {
  statusPulse.className = 'status-pulse ' + status;
  statusLabel.textContent = label;
  statusDesc.textContent = desc;

  if (status === 'connected') {
    accountBodyLoggedIn.style.display = 'flex';
    accountBodyNotLogged.style.display = 'none';

    const name = user?.name || 'Tài khoản Zalo';
    userDisplayName.textContent = name;

    if (user?.avatar) {
      if (userAvatarImg) {
        userAvatarImg.src = user.avatar;
        userAvatarImg.classList.remove('hidden');
      }
      userAvatarLetter.classList.add('hidden');
    } else {
      userAvatarLetter.textContent = (name[0] || 'Z').toUpperCase();
      userAvatarLetter.classList.remove('hidden');
      if (userAvatarImg) userAvatarImg.classList.add('hidden');
    }

    // Ẩn khung QR
    qrPlaceholder.classList.remove('hidden');
    qrPlaceholder.innerHTML = '<div class="qr-icon-placeholder" style="color: #10B981;">✅</div><p style="color: #10B981; font-weight: 700;">Đã đăng nhập thành công!</p>';
    qrImage.classList.add('hidden');
    qrLoading.classList.add('hidden');
    btnGenerateQR.disabled = true;
    btnGenerateQR.style.opacity = '0.5';
  } else {
    accountBodyLoggedIn.style.display = 'none';
    accountBodyNotLogged.style.display = 'flex';
    btnGenerateQR.disabled = false;
    btnGenerateQR.style.opacity = '1';
  }
}

// Bấm tạo mã QR
btnGenerateQR.addEventListener('click', async () => {
  qrPlaceholder.classList.add('hidden');
  qrImage.classList.add('hidden');
  qrLoading.classList.remove('hidden');

  statusLabel.textContent = 'Đang tạo QR...';
  statusDesc.textContent = 'Đang khởi tạo phiên Zalo API';

  try {
    const res = await window.electronAPI.startLoginQR();
    if (res && res.qr) {
      displayQRCode(res.qr);
    }
  } catch (e) {
    qrLoading.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    qrPlaceholder.innerHTML = `<div class="qr-icon-placeholder" style="color: #EF4444;">⚠️</div><p style="color: #EF4444;">Lỗi: ${e.message}</p>`;
  }
});

function displayQRCode(qrDataUrl) {
  qrLoading.classList.add('hidden');
  qrPlaceholder.classList.add('hidden');
  qrImage.src = qrDataUrl;
  qrImage.classList.remove('hidden');

  updateConnectionUI('connecting', 'Chờ quét QR', 'Mở Zalo trên điện thoại để quét mã');
}

// Lắng nghe sự kiện từ main process
if (window.electronAPI && window.electronAPI.onZaloStatus) {
  window.electronAPI.onZaloStatus((data) => {
    console.log('Zalo status event:', data);

    if (data.status === 'qr_ready') {
      displayQRCode(data.qrImage);
    } else if (data.status === 'qr_scanned') {
      updateConnectionUI('connecting', 'Đã quét QR', 'Vui lòng nhấn Xác nhận trên điện thoại');
    } else if (data.status === 'connected') {
      updateConnectionUI('connected', 'Đã kết nối', 'Đang lắng nghe tin nhắn Zalo', data.user);
      // Tự động tải danh sách nhóm Zalo khi vừa kết nối
      loadGroupsData();
      loadMyCloudId().catch(error => console.warn('Không tải được ID Cloud:', error.message));
    } else if (data.status === 'connecting') {
      updateConnectionUI('connecting', 'Đang kết nối', data.message || 'Đang kết nối tin nhắn Zalo');
    } else if (data.status === 'disconnected') {
      updateConnectionUI('disconnected', 'Chưa kết nối', data.message || 'Cần đăng nhập Zalo');
    } else if (data.status === 'qr_expired') {
      qrLoading.classList.add('hidden');
      qrImage.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrPlaceholder.innerHTML = '<div class="qr-icon-placeholder" style="color: #F59E0B;">⏰</div><p>Mã QR đã hết hạn. Vui lòng bấm tạo lại.</p>';
      updateConnectionUI('disconnected', 'Mã QR hết hạn', 'Bấm Tạo mã QR để thử lại');
    } else if (data.status === 'phone_sync_confirmed') {
      showToast(data.message || '📱 Điện thoại đã xác nhận đồng bộ! Đang tải tin nhắn...', 'info');
      setTimeout(async () => {
        await refreshConversationHeads();
      }, 1200);
    } else if (data.status === 'error') {
      qrLoading.classList.add('hidden');
      updateConnectionUI('disconnected', 'Lỗi kết nối', data.message);
    }
  });
}

// Đăng xuất
btnLogout.addEventListener('click', async () => {
  if (confirm('Bạn có chắc chắn muốn đăng xuất tài khoản Zalo không?')) {
    const ok = await window.electronAPI.logoutZalo();
    if (ok) {
      updateConnectionUI('disconnected', 'Chưa kết nối', 'Đã đăng xuất tài khoản');
      qrPlaceholder.classList.remove('hidden');
      qrPlaceholder.innerHTML = '<div class="qr-icon-placeholder">📱</div><p>Bấm nút bên dưới để tạo mã QR đăng nhập</p>';
      qrImage.classList.add('hidden');
    }
  }
});

// Hiển thị thông báo Toast đẹp mắt
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);

  // Trigger animation show
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3500);
}

// Kiểm tra phiên đăng nhập đã lưu và nạp lịch sử tin nhắn
window.addEventListener('DOMContentLoaded', async () => {
  const localAccount = await window.electronAPI.getCurrentAccount?.();
  const localAccountName = document.getElementById('local-account-name');
  if (localAccountName && localAccount) localAccountName.textContent = localAccount.name;
  const localAccountSummary = document.getElementById('local-account-summary');
  if (localAccountSummary && localAccount) localAccountSummary.textContent = localAccount.name;
  const localAccountAvatar = document.querySelector('.local-account-avatar');
  if (localAccountAvatar && localAccount?.name) localAccountAvatar.textContent = localAccount.name[0].toUpperCase();
  updateLocalPasswordUI(localAccount);
  // 1. Kiểm tra session Zalo
  if (window.electronAPI && window.electronAPI.checkSavedSession) {
    const res = await window.electronAPI.checkSavedSession();
    if (res && res.hasSession) {
      if (res.currentUser) {
        updateConnectionUI('connected', 'Đã kết nối', 'Đang lắng nghe tin nhắn Zalo', res.currentUser);
      } else {
        updateConnectionUI('connecting', 'Đang kết nối lại...', 'Tự động đăng nhập từ phiên đã lưu');
      }
    }
  }

  // 2. Nạp danh bạ bạn bè & nhóm trong cache trước (chưa render để tránh nháy màn hình)
  await loadGroupsData(false);
  await loadMyCloudId().catch(error => console.warn('Không tải được ID Cloud:', error.message));

  // 3. Chỉ nạp tin mới nhất của mỗi hội thoại; phần còn lại mở theo trang khi cần.
  try {
    await refreshConversationHeads(false);
    const status = await window.electronAPI.getSyncStatus?.();
    const statusDesc = document.getElementById('local-storage-status-desc');
    if (statusDesc && status?.totalMessages != null) {
      statusDesc.textContent = `💾 Đã lưu cục bộ: ${Number(status.totalMessages).toLocaleString('vi-VN')} tin nhắn • Mở hội thoại để xem lịch sử`;
    }
  } catch (e) {
    console.warn('Lỗi khi nạp danh sách hội thoại:', e);
  }

  // 4. Render 1 lần duy nhất khi toàn bộ dữ liệu đã sẵn sàng: siêu tốc và không nháy!
  renderDashboardFeed();
});

function updateLocalPasswordUI(account) {
  const current = document.getElementById('current-account-password');
  const note = document.getElementById('local-account-password-note');
  if (current) current.required = !!account?.requiresPassword;
  if (note) note.textContent = account?.requiresPassword
    ? 'Tài khoản đang có mật khẩu. Để trống mật khẩu mới nếu muốn gỡ khóa.'
    : 'Tài khoản đang mở không cần mật khẩu. Nhập mật khẩu mới nếu muốn bật khóa.';
}

window.AccountModal.setupAccountModal({
  dialog: document.getElementById('local-account-modal'),
  trigger: document.getElementById('btn-open-local-account-modal'),
  close: document.getElementById('btn-close-local-account-modal'),
  form: document.getElementById('account-password-form')
});

document.getElementById('btn-switch-account')?.addEventListener('click', async () => {
  await window.electronAPI.switchAccount();
});

window.electronAPI.onAccountNameUpdated?.(name => {
  const label = document.getElementById('local-account-name');
  if (label) label.textContent = name;
  const summary = document.getElementById('local-account-summary');
  if (summary) summary.textContent = name;
  const avatar = document.querySelector('.local-account-avatar');
  if (avatar && name) avatar.textContent = name[0].toUpperCase();
});

document.getElementById('account-password-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const current = document.getElementById('current-account-password');
  const next = document.getElementById('new-account-password');
  const confirm = document.getElementById('confirm-account-password');
  const account = await window.electronAPI.getCurrentAccount();
  if (!account?.requiresPassword && !next.value) {
    showToast('Nhập mật khẩu mới để bật khóa tài khoản', 'info'); return;
  }
  if (next.value !== confirm.value) { showToast('Hai mật khẩu mới chưa khớp', 'error'); return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await window.electronAPI.changeAccountPassword(current.value, next.value);
    if (result.success) {
      form.reset();
      updateLocalPasswordUI({ requiresPassword: result.requiresPassword });
      showToast(result.requiresPassword ? 'Đã cập nhật mật khẩu tài khoản' : 'Đã gỡ mật khẩu tài khoản', 'success');
    } else showToast(result.error || 'Không thể đổi mật khẩu', 'error');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; }
});

// =========================================
// 3. NHẬT KÝ TIN NHẮN TRỰC TIẾP (LIVE STREAM)
// =========================================
const btnSyncMessages = document.getElementById('btn-sync-messages');
const syncIcon = document.getElementById('sync-icon');
const syncText = document.getElementById('sync-text');

if (btnSyncMessages) {
  btnSyncMessages.addEventListener('click', async () => {
    openSyncModal();

    syncIcon.style.animation = 'spin 0.8s linear infinite';
    syncText.textContent = 'Đang đồng bộ...';
    btnSyncMessages.disabled = true;

    try {
      if (window.electronAPI && window.electronAPI.syncOldMessages) {
        const res = await window.electronAPI.syncOldMessages();
        console.log('Kết quả đồng bộ:', res);

        if (res?.requestAccepted) {
          showToast(res.message || 'Máy chủ đã nhận yêu cầu. Đang chờ điện thoại phản hồi.', 'info');
        } else if (res?.success && res?.completed) {
          await refreshConversationHeads();
        } else {
          showToast(res?.error || 'Không thể đồng bộ tin nhắn từ Zalo', 'error');
          closeSyncModal();
        }
      } else {
        showToast('API đồng bộ không khả dụng trên trình duyệt', 'warning');
        closeSyncModal();
      }
    } catch (err) {
      showToast('Lỗi đồng bộ: ' + (err.message || 'Mất kết nối Zalo'), 'error');
      closeSyncModal();
    } finally {
      syncIcon.style.animation = '';
      syncText.textContent = 'Đồng bộ từ điện thoại';
      btnSyncMessages.disabled = false;
    }
  });
}

let renderFeedRAF = null;
let queuedOldMessages = [];
let queuedOldMessagesRAF = null;
function scheduleRenderFeed() {
  if (renderFeedRAF) cancelAnimationFrame(renderFeedRAF);
  renderFeedRAF = requestAnimationFrame(() => {
    renderDashboardFeed();
    renderFeedRAF = null;
  });
}

function addMessageToDashboard(msg, isOld = false) {
  // Loại bỏ hoàn toàn mục fake conversation (chứa status người khác)
  if (!msg || msg.isConversation || (msg.id && msg.id.startsWith('conv_'))) return;

  if (isOld) {
    queuedOldMessages.push(msg);
    if (!queuedOldMessagesRAF) {
      queuedOldMessagesRAF = requestAnimationFrame(() => {
        queuedOldMessagesRAF = null;
        const batch = queuedOldMessages;
        queuedOldMessages = [];
        messagesHistory = window.LazyHistory.mergeIncomingHistory(messagesHistory, batch, activeThreadId);
        renderDashboardFeed();
      });
    }
    return;
  }

  // Tránh trùng lặp tin nhắn
  const exists = messagesHistory.some(m => String(m.threadId) === String(msg.threadId) && String(m.id) === String(msg.id));
  if (exists) return;

  messagesHistory.push(msg);
  messagesHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (feedEmpty) feedEmpty.style.display = 'none';

  if (!isOld && currentTab !== 'tab-messages') {
    unreadMessageCount++;
    tabUnreadBadge.textContent = unreadMessageCount > 99 ? '99+' : unreadMessageCount;
    tabUnreadBadge.classList.remove('hidden');
  }

  // Nếu tin nhắn đến trong cuộc trò chuyện đang xem, tự động đánh dấu đã xem
  if (typeof activeThreadId !== 'undefined' && activeThreadId && String(msg.threadId) === String(activeThreadId) && typeof markThreadAsRead === 'function') {
    markThreadAsRead(activeThreadId);
  }

  // Tối ưu mượt mà: Dùng requestAnimationFrame khi nhận loạt tin cũ để tránh đơ DOM và crash renderer
  if (isOld) {
    scheduleRenderFeed();
  } else {
    renderDashboardFeed();
    const statusDesc = document.getElementById('local-storage-status-desc');
    if (statusDesc && messagesHistory.length > 0) {
      statusDesc.textContent = '💾 Tin nhắn được lưu cục bộ • Mở hội thoại để xem lịch sử';
    }
  }
}

// Lắng nghe sự kiện thu hồi tin nhắn từ người khác hoặc chính mình
if (window.electronAPI && window.electronAPI.onMessageUndo) {
  window.electronAPI.onMessageUndo((undoData) => {
    console.log('🔄 [Dashboard] Nhận sự kiện thu hồi tin nhắn:', undoData);
    if (!undoData) return;
    const targetId = String(undoData.msgId || '');
    const targetCli = String(undoData.cliMsgId || '');
    let updated = false;

    messagesHistory.forEach(m => {
      const matchId = targetId && (String(m.id) === targetId || String(m.msgId) === targetId);
      const matchCli = targetCli && String(m.cliMsgId) === targetCli;
      if (matchId || matchCli) {
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
    });

    // Nếu chưa có tin nhắn này trong history (người khác thu hồi ngay tức thì)
    if (!updated && undoData.threadId) {
      messagesHistory.unshift({
        id: targetId || ('undo_' + Date.now()),
        cliMsgId: targetCli || String(Date.now()),
        threadId: undoData.threadId,
        senderName: undoData.senderName || (undoData.isSelf ? 'Bạn (Tôi)' : 'Người gửi'),
        isSelf: undoData.isSelf,
        isGroup: undoData.isGroup,
        isUndo: true,
        isRevoked: true,
        isRecalled: true,
        content: 'Tin nhắn đã được thu hồi',
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      });
      updated = true;
    }

    if (updated) {
      renderDashboardFeed();
      // Luôn cập nhật lại khung chat active nếu thuộc cuộc trò chuyện này
      if (activeThreadId && (String(activeThreadId) === String(undoData.threadId) || !undoData.threadId)) {
        renderActiveChatThread();
      }
      // Cập nhật lại Panel Thông tin hội thoại nếu đang mở
      if (typeof isInfoPanelOpen !== 'undefined' && isInfoPanelOpen && typeof renderConversationInfoPanel === 'function') {
        renderConversationInfoPanel();
      }
      showToast(`Một tin nhắn đã được thu hồi bởi ${undoData.senderName || 'người gửi'}`, 'info');
    }
  });
}

if (window.electronAPI?.onPhotoCaptionUpdated) {
  window.electronAPI.onPhotoCaptionUpdated(({ threadId, msgId, photoCaption }) => {
    let changed = false;
    for (const message of messagesHistory) {
      if (String(message.id) !== String(msgId) || String(message.threadId) !== String(threadId)) continue;
      message.photoCaption = photoCaption;
      changed = true;
    }
    if (changed && String(activeThreadId) === String(threadId)) renderActiveChatThread();
  });
}

// Lắng nghe sự kiện reaction từ người khác hoặc chính mình
if (window.electronAPI && window.electronAPI.onMessageReaction) {
  window.electronAPI.onMessageReaction((reactionData) => {
    console.log('❤️ [Dashboard] Nhận sự kiện reaction cập nhật:', reactionData);
    if (!reactionData) return;
    const targetId = String(reactionData.msgId || '');
    const targetCli = String(reactionData.cliMsgId || '');
    const targetThread = String(reactionData.threadId || '').replace(/^g_/, '');
    let updated = false;

    messagesHistory.forEach(m => {
      const matchId = targetId && targetId !== '0' && (String(m.id) === targetId || String(m.msgId) === targetId);
      const matchCli = targetCli && String(m.cliMsgId) === targetCli;
      if (matchId || matchCli) {
        if (!Array.isArray(m.reactions)) m.reactions = [];
        if (Array.isArray(reactionData.reactions) && reactionData.reactions.length > 0) {
          m.reactions = reactionData.reactions;
        } else if (reactionData.icon) {
          const sId = String(reactionData.senderId || '');
          const exIdx = m.reactions.findIndex(r => String(r.senderId) === sId);
          if (reactionData.rType === -1) {
            if (exIdx >= 0) m.reactions.splice(exIdx, 1);
          } else {
            if (exIdx >= 0) {
              m.reactions[exIdx].icon = reactionData.icon;
              m.reactions[exIdx].senderName = reactionData.senderName || m.reactions[exIdx].senderName;
            } else {
              m.reactions.push({
                icon: reactionData.icon,
                senderId: sId,
                senderName: reactionData.senderName || 'Thành viên'
              });
            }
          }
        }
        updated = true;
      }
    });

    if (updated) {
      if (activeThreadId && (String(activeThreadId).replace(/^g_/, '') === targetThread || !targetThread)) {
        renderActiveChatThread();
      }
    }
  });
}

// =========================================
// QUẢN LÝ HỘI THOẠI 2 CỘT & NHÓM CHUẨN ZALO
// =========================================
let activeThreadId = null;
const threadVisibleCounts = new Map();
const threadHistoryExhausted = new Set();
const threadHistoryLoading = new Set();
const threadHistoryLoaded = new Set();

async function refreshConversationHeads(shouldRender = true) {
  if (!window.electronAPI?.getConversationHeads) return;
  const heads = await window.electronAPI.getConversationHeads();
  if (!Array.isArray(heads)) return;
  const activeMessages = messagesHistory.filter(message => String(message.threadId) === String(activeThreadId));
  messagesHistory = window.LazyHistory.retainActiveThreadMessages([...heads, ...activeMessages], activeThreadId);
  for (const key of [...threadHistoryLoaded]) if (String(key) !== String(activeThreadId)) threadHistoryLoaded.delete(key);
  if (shouldRender) renderDashboardFeed();
}

async function loadRecentThreadHistory(threadId) {
  const key = String(threadId);
  if (!window.electronAPI?.getThreadHistory || threadHistoryLoaded.has(key) || threadHistoryLoading.has(key)) return;
  threadHistoryLoading.add(key);
  try {
    let page = await window.electronAPI.getThreadHistory(key, 50, 0);
    if (key === myCloudId && page.length === 0 && window.electronAPI.fetchCloudMessages) {
      const cloud = await window.electronAPI.fetchCloudMessages();
      cloudRecentRefreshAt = Date.now();
      page = cloud.messages || [];
      if (cloud.hasMore && cloud.lastMsgId) cloudOlderCursor.set(key, cloud.lastMsgId);
      else threadHistoryExhausted.add(key);
    }
    const known = new Set(messagesHistory.map(message => `${message.threadId}:${message.id}`));
    for (const message of page) {
      const identity = `${message.threadId}:${message.id}`;
      if (!known.has(identity)) {
        messagesHistory.push(message);
        known.add(identity);
      }
    }
    if (page.length > 0) messagesHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    threadHistoryLoaded.add(key);
    if (String(activeThreadId) === key) renderDashboardFeed();
  } catch (error) {
    console.warn('Không tải được lịch sử hội thoại:', error.message);
  } finally {
    threadHistoryLoading.delete(key);
  }
}
const groupSenderLookupAt = new Map();
async function resolveVisibleGroupSenders(thread) {
  if (!thread?.isGroup || !window.electronAPI?.resolveGroupSenderNames) return;
  const now = Date.now();
  const ids = [...new Set(thread.messages
    .filter(msg => !msg.isSelf && (!msg.senderName || msg.senderName === 'Thành viên nhóm'))
    .map(msg => String(msg.senderId || '')))]
    .filter(id => /^\d{7,11}$/.test(id) && now - (groupSenderLookupAt.get(id) || 0) > 300000)
    .slice(0, 50);
  if (!ids.length) return;
  ids.forEach(id => groupSenderLookupAt.set(id, now));
  try {
    const profiles = await window.electronAPI.resolveGroupSenderNames(thread.threadId, ids);
    const byId = new Map((profiles || []).map(profile => [String(profile.plainId), profile]));
    if (!byId.size) return;
    for (const msg of messagesHistory) {
      if (String(msg.threadId) !== String(thread.threadId)) continue;
      const profile = byId.get(String(msg.senderId));
      if (!profile || msg.isSelf) continue;
      msg.senderName = profile.name;
      if (profile.avatar && !msg.avatar) msg.avatar = profile.avatar;
    }
    if (String(activeThreadId) !== String(thread.threadId)) return;
    for (const row of chatMessagesScroll.querySelectorAll('.chat-msg-row[data-sender-id]')) {
      const profile = byId.get(row.dataset.senderId);
      if (!profile) continue;
      const heading = row.querySelector('.chat-msg-sender');
      if (heading) heading.textContent = profile.name;
      const avatar = row.querySelector('.chat-msg-avatar');
      if (avatar) {
        avatar.textContent = profile.name[0].toUpperCase();
        if (profile.avatar) {
          const img = document.createElement('img');
          img.src = profile.avatar;
          img.className = 'conv-avatar-img';
          img.onerror = () => { img.remove(); avatar.textContent = profile.name[0].toUpperCase(); };
          avatar.replaceChildren(img);
        }
      }
    }
  } catch (error) {
    console.warn('Không tải được tên thành viên nhóm:', error.message);
  }
}
let messageFocusId = null;
let searchQuery = '';
let allGroupsList = [];
let allFriendsList = [];
let currentFilter = 'all'; // 'all' | 'user' | 'group' | 'pinned'
let pinnedThreadIds = new Set();
const pinnedConversationsFilter = document.getElementById('pinned-conversations-filter');
const pinnedConversationsCount = document.getElementById('pinned-conversations-count');
let mutedThreadIds = new Set();
let replyingToMessage = null;
let selectedAttachment = null;

// =========================================
// QUẢN LÝ TRẠNG THÁI ĐÃ ĐỌC TIN NHẮN (LƯU LOCAL)
// =========================================
const dashboardAccountParams = new URLSearchParams(window.location.search);
const accountStorage = createAccountStorage(window.localStorage,
  dashboardAccountParams.get('accountId'), dashboardAccountParams.get('legacy') === '1');
const STORAGE_KEY_READ_THREADS = 'nhitzalo_read_thread_timestamps';

function loadReadThreadsLocal() {
  try {
    const raw = accountStorage.getItem(STORAGE_KEY_READ_THREADS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Lỗi đọc trạng thái đã xem tin nhắn từ local:', e);
  }
  return {};
}

function saveReadThreadsLocal(data) {
  try {
    accountStorage.setItem(STORAGE_KEY_READ_THREADS, JSON.stringify(data));
  } catch (e) {
    console.warn('Lỗi lưu trạng thái đã xem tin nhắn vào local:', e);
  }
}

let readThreadTimestamps = loadReadThreadsLocal();

// Đồng bộ trạng thái đã đọc từ Main Process khi mở Dashboard
if (window.electronAPI && window.electronAPI.getReadThreads) {
  window.electronAPI.getReadThreads().then(remoteRead => {
    if (remoteRead && typeof remoteRead === 'object') {
      readThreadTimestamps = { ...readThreadTimestamps, ...remoteRead };
      saveReadThreadsLocal(readThreadTimestamps);
      if (typeof renderDashboardFeed === 'function') {
        renderDashboardFeed();
      }
      if (typeof updateDashboardTabUnread === 'function') {
        updateDashboardTabUnread();
      }
    }
  }).catch(() => {});
}

// Cập nhật tổng số tin chưa đọc trên tab tin nhắn của Dashboard
function updateDashboardTabUnread() {
  // Trên tab tin nhắn badge luôn ẩn; bỏ qua phép nhóm và sắp xếp toàn bộ lịch sử
  // để thao tác mở hội thoại không bị chặn khi dữ liệu lớn.
  if (currentTab === 'tab-messages') {
    tabUnreadBadge?.classList.add('hidden');
    return;
  }
  if (typeof getGroupedThreads !== 'function') return;
  const threads = getGroupedThreads();
  let total = 0;
  for (const t of threads) {
    total += getThreadUnreadCount(t);
  }
  unreadMessageCount = total;
  if (tabUnreadBadge) {
    if (total > 0 && typeof currentTab !== 'undefined' && currentTab !== 'tab-messages') {
      tabUnreadBadge.textContent = total > 99 ? '99+' : total;
      tabUnreadBadge.classList.remove('hidden');
    } else {
      tabUnreadBadge.classList.add('hidden');
    }
  }
}

// Đánh dấu đã xem toàn bộ tin nhắn của cuộc trò chuyện này
function markThreadAsRead(threadId) {
  if (!threadId) return;
  const tid = String(threadId);
  const cleanId = tid.replace(/^g_/, '');
  const now = Date.now();
  readThreadTimestamps[tid] = now;
  readThreadTimestamps[cleanId] = now;
  readThreadTimestamps['g_' + cleanId] = now;
  saveReadThreadsLocal(readThreadTimestamps);

  // Đồng bộ sang Main process và Bong bóng chat
  if (window.electronAPI && window.electronAPI.markThreadRead) {
    window.electronAPI.markThreadRead(threadId);
  }
  updateDashboardTabUnread();
}

// Tính số tin nhắn chưa đọc của cuộc hội thoại
function getThreadUnreadCount(thread) {
  if (!thread) return 0;
  const tid = String(thread.threadId);
  const cleanId = tid.replace(/^g_/, '');

  // Nếu đang mở xem cuộc trò chuyện này thì số chưa đọc = 0 (không hiện badge)
  if (activeThreadId && (String(activeThreadId) === tid || String(activeThreadId).replace(/^g_/, '') === cleanId)) {
    return 0;
  }

  const lastRead = Math.max(
    Number(readThreadTimestamps[tid]) || 0,
    Number(readThreadTimestamps[cleanId]) || 0,
    Number(readThreadTimestamps['g_' + cleanId]) || 0
  );

  // Nếu người dùng đã từng xem (ở Dashboard hoặc trên Bong bóng chat):
  if (lastRead > 0) {
    // Chỉ đếm các tin nhắn từ người khác gửi đến SAU thời điểm đã xem
    const unreadMsgs = (thread.messages || []).filter(m => {
      if (m.isSelf) return false;
      const msgTime = Number(m.timestamp) || 0;
      return msgTime > lastRead;
    });
    return unreadMsgs.length;
  }

  // Nếu chưa từng click vào xem:
  // Đếm các tin nhắn đến từ người khác
  const incomingMsgs = (thread.messages || []).filter(m => !m.isSelf);
  return incomingMsgs.length;
}

// Lắng nghe sự kiện hội thoại đã được đọc từ Bong bóng chat để lập tức ẩn số tin chưa đọc trên Dashboard
if (window.electronAPI && window.electronAPI.onThreadMarkedAsRead) {
  window.electronAPI.onThreadMarkedAsRead(({ threadId, cleanId, timestamp }) => {
    const sId = String(threadId || '');
    const cId = String(cleanId || sId.replace(/^g_/, ''));
    const now = Number(timestamp) || Date.now();
    readThreadTimestamps[sId] = now;
    readThreadTimestamps[cId] = now;
    readThreadTimestamps['g_' + cId] = now;
    saveReadThreadsLocal(readThreadTimestamps);

    // Chỉ cập nhật badge. Dựng lại toàn bộ danh sách ở đây có thể thay DOM
    // ngay trong lúc người dùng đang bấm chọn một hội thoại.
    conversationList?.querySelectorAll('.conv-item').forEach(item => {
      const itemId = String(item.dataset.threadId || '');
      if (itemId === sId || itemId.replace(/^g_/, '') === cId) {
        item.querySelector('.conv-badge')?.remove();
      }
    });
    updateDashboardTabUnread();
  });
}

// =========================================
// QUẢN LÝ TẢI VÀ THAO TÁC TỆP TIN (DOWNLOAD)
// =========================================
function getFileIconSrc(fileName = '') {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '../assets/zalo-icons/File_Excel_48_Colored.svg';
  if (['doc', 'docx'].includes(ext)) return '../assets/zalo-icons/File_Word_48_Colored.svg';
  if (['pdf'].includes(ext)) return '../assets/zalo-icons/File_Pdf_48_Colored.svg';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '../assets/zalo-icons/File_Zip_48_Colored.svg';
  return '../assets/zalo-icons/File_Attachment_48_Colored.svg';
}

const downloadedFilePaths = new Map();

async function handleDownloadFile(fileUrl, fileName, promptSaveAs = false, triggerBtn = null) {
  if (!fileUrl) {
    showToast('Tệp tin không có liên kết tải', 'warning');
    return;
  }
  if (!window.electronAPI || !window.electronAPI.downloadFile) {
    window.open(fileUrl, '_blank');
    return;
  }

  const origText = triggerBtn ? triggerBtn.innerHTML : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '⏳ Đang tải...';
  }
  showToast(`Đang tải tệp tin: ${fileName}...`, 'info');

  try {
    const res = await window.electronAPI.downloadFile(fileUrl, fileName, promptSaveAs);
    if (res && res.canceled) {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origText;
      }
      return;
    }

    if (res && res.success && res.filePath) {
      downloadedFilePaths.set(fileUrl, res.filePath);
      showToast(`Đã tải xong: ${res.fileName}!`, 'success');

      if (triggerBtn && triggerBtn.parentElement) {
        const container = triggerBtn.parentElement;
        container.innerHTML = `
          <button class="btn-file-open" title="Mở tệp tin">📄 Mở tệp</button>
          <button class="btn-file-folder" title="Mở thư mục chứa">📂 Mở thư mục</button>
        `;
        const btnOpen = container.querySelector('.btn-file-open');
        const btnFolder = container.querySelector('.btn-file-folder');
        if (btnOpen) {
          btnOpen.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.openFilePath(res.filePath);
          });
        }
        if (btnFolder) {
          btnFolder.addEventListener('click', (e) => {
            e.stopPropagation();
            window.electronAPI.showItemInFolder(res.filePath);
          });
        }
      }
    } else {
      showToast('Lỗi tải tệp: ' + (res?.error || 'Không xác định'), 'error');
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origText;
      }
    }
  } catch (err) {
    showToast('Lỗi tải tệp: ' + err.message, 'error');
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = origText;
    }
  }
}

const conversationList = document.getElementById('conversation-list');
const conversationSearch = document.getElementById('conversation-search');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatName = document.getElementById('active-chat-name');
const activeChatType = document.getElementById('active-chat-type');
const activeChatCount = document.getElementById('active-chat-count');
const btnToggleMuteChat = document.getElementById('btn-toggle-mute-chat');
const iconMuteHeader = document.getElementById('icon-mute-header');
const iconBellHeader = document.getElementById('icon-bell-header');
const chatMessagesScroll = document.getElementById('chat-messages-scroll');
const linkPreviewRequests = new Map();
const linkPreviewQueue = [];
let activeLinkPreviewRequests = 0;
let linkPreviewObserver = null;
if (chatMessagesScroll) chatMessagesScroll.addEventListener('click', event => {
  const link = event.target.closest('.chat-link-card');
  if (!link) return;
  event.preventDefault();
  window.electronAPI?.openExternalLink?.(link.dataset.linkUrl);
});

async function loadLinkPreviewCard(card, msg) {
  if (!window.electronAPI?.getLinkPreview) return;
  const url = card.dataset.linkUrl;
  if (!url || (msg.linkPreview?.title && msg.linkPreview?.image && msg.linkPreview?.description)) return;
  if (!linkPreviewRequests.has(url)) {
    const request = new Promise(resolve => {
      linkPreviewQueue.push(async () => {
        try { resolve(await window.electronAPI.getLinkPreview(url)); }
        catch (_) { resolve(null); }
        finally {
          activeLinkPreviewRequests--;
          drainLinkPreviewQueue();
        }
      });
      drainLinkPreviewQueue();
    });
    linkPreviewRequests.set(url, request);
    if (linkPreviewRequests.size > 500) linkPreviewRequests.delete(linkPreviewRequests.keys().next().value);
  }
  const metadata = await linkPreviewRequests.get(url);
  if (!metadata || !card.isConnected) return;
  msg.linkPreview = { ...metadata, ...Object.fromEntries(Object.entries(msg.linkPreview || {}).filter(([, value]) => value)) };
  card.closest('.chat-link-wrapper').outerHTML = window.LinkPreview.renderCard(msg, msg.linkPreview);
}

function drainLinkPreviewQueue() {
  while (activeLinkPreviewRequests < 3 && linkPreviewQueue.length) {
    activeLinkPreviewRequests++;
    linkPreviewQueue.shift()();
  }
}
const chatReplyInput = document.getElementById('chat-reply-input');
const btnSendChatReply = document.getElementById('btn-send-chat-reply');
const btnFetchGroups = document.getElementById('btn-fetch-groups');
const groupFilterCount = document.getElementById('group-filter-count');
const filterBtns = document.querySelectorAll('.chat-filter-btn');

// Các phần tử cho tính năng mới
const btnToggleInfoPanel = document.getElementById('btn-toggle-info-panel');
const chatInfoPanel = document.getElementById('chat-info-panel');
const btnCloseInfoPanel = document.getElementById('btn-close-info-panel');
const chatInfoBody = document.getElementById('chat-info-body');
const chatQuoteBar = document.getElementById('chat-quote-bar');
const chatQuoteTitle = document.getElementById('chat-quote-title');
const chatQuoteText = document.getElementById('chat-quote-text');
const btnCancelQuote = document.getElementById('btn-cancel-quote');
const btnAttachFile = document.getElementById('btn-attach-file');
const btnQuickPhoto = document.getElementById('btn-quick-photo');
const btnToggleEmoji = document.getElementById('btn-toggle-emoji');
const emojiPickerContainer = document.getElementById('emoji-picker-container');
const btnCloseEmojiPicker = document.getElementById('btn-close-emoji-picker');
const emojiGrid = document.getElementById('emoji-grid');
const stickerGrid = document.getElementById('sticker-grid');
const chatAttachPreview = document.getElementById('chat-attach-preview');
const attachPreviewName = document.getElementById('attach-preview-name');
const btnCancelAttach = document.getElementById('btn-cancel-attach');

// Lightbox Modal
const imageLightboxModal = document.getElementById('image-lightbox-modal');
const lightboxOverlay = document.getElementById('lightbox-overlay');
const lightboxImg = document.getElementById('lightbox-img');
const btnLightboxClose = document.getElementById('btn-lightbox-close');
const btnLightboxExternal = document.getElementById('btn-lightbox-external');

// In-chat Search (Thanh tìm kiếm tin nhắn trong hội thoại)
const btnToggleInchatSearch = document.getElementById('btn-toggle-inchat-search');
const inchatSearchBar = document.getElementById('inchat-search-bar');
const inchatSearchInput = document.getElementById('inchat-search-input');
const inchatSearchCount = document.getElementById('inchat-search-count');
const btnInchatSearchPrev = document.getElementById('btn-inchat-search-prev');
const btnInchatSearchNext = document.getElementById('btn-inchat-search-next');
const btnInchatSearchClose = document.getElementById('btn-inchat-search-close');

// Context Menu (Menu chuột phải cho tin nhắn)
const chatContextMenu = document.getElementById('chat-context-menu');
const ctxCopyText = document.getElementById('ctx-copy-text');
const ctxCopyLink = document.getElementById('ctx-copy-link');
const ctxForwardMsg = document.getElementById('ctx-forward-msg');
const ctxReplyMsg = document.getElementById('ctx-reply-msg');
const ctxFileDivider = document.getElementById('ctx-file-divider');
const ctxDownloadFile = document.getElementById('ctx-download-file');
const ctxOpenFile = document.getElementById('ctx-open-file');
const ctxShowFolder = document.getElementById('ctx-show-folder');
const ctxUndoDivider = document.getElementById('ctx-undo-divider');
const ctxUndoMsg = document.getElementById('ctx-undo-msg');

// Forward Modal (Modal chuyển tiếp tin nhắn)
const forwardModalOverlay = document.getElementById('forward-modal-overlay');
const btnCloseForwardModal = document.getElementById('btn-close-forward-modal');
const forwardPreviewContent = document.getElementById('forward-preview-content');
const forwardSearchInput = document.getElementById('forward-search-input');
const forwardTargetList = document.getElementById('forward-target-list');
const forwardSelectedHint = document.getElementById('forward-selected-hint');
const btnCancelForward = document.getElementById('btn-cancel-forward');
const btnConfirmForward = document.getElementById('btn-confirm-forward');

// ============================================================
// TÍNH NĂNG ƯU TIÊN 2: DOM ELEMENTS
// ============================================================
// 1. Thanh Ghim Tin Nhắn
const chatPinnedBar = document.getElementById('chat-pinned-bar');
const pinnedBarContent = document.getElementById('pinned-bar-content');
const pinnedBarSender = document.getElementById('pinned-bar-sender');
const pinnedBarText = document.getElementById('pinned-bar-text');
const pinnedBarCount = document.getElementById('pinned-bar-count');
const btnPinnedPrev = document.getElementById('btn-pinned-prev');
const btnPinnedNext = document.getElementById('btn-pinned-next');
const btnPinnedUnpin = document.getElementById('btn-pinned-unpin');

// 2. Menu Chuột Phải Cho Tin Nhắn: Thêm Ghim tin nhắn
const ctxPinMsg = document.getElementById('ctx-pin-msg');
const ctxPinLabel = document.getElementById('ctx-pin-label');

// 3. Menu Chuột Phải Cho Danh Sách Hội Thoại
const convContextMenu = document.getElementById('conv-context-menu');
const ctxConvPin = document.getElementById('ctx-conv-pin');
const ctxConvPinLabel = document.getElementById('ctx-conv-pin-label');
const ctxConvMute = document.getElementById('ctx-conv-mute');
const ctxConvMuteIcon = document.getElementById('ctx-conv-mute-icon');
const ctxConvMuteLabel = document.getElementById('ctx-conv-mute-label');
const ctxConvUnread = document.getElementById('ctx-conv-unread');
const ctxConvClear = document.getElementById('ctx-conv-clear');

// 4. Kéo Thả Tệp Tin & Hình Ảnh
const chatMain = document.getElementById('chat-main');
const dragDropOverlay = document.getElementById('drag-drop-overlay');

// ============================================================
// TÍNH NĂNG ƯU TIÊN 3: DOM ELEMENTS (BÌNH CHỌN, NHẮC HẸN, HỒ SƠ)
// ============================================================
// Header buttons
const btnToggleGroupPoll = document.getElementById('btn-toggle-group-poll');
const btnToggleGroupReminder = document.getElementById('btn-toggle-group-reminder');

// Poll Modal
const pollModalOverlay = document.getElementById('poll-modal-overlay');
const btnClosePollModal = document.getElementById('btn-close-poll-modal');
const pollQuestionInput = document.getElementById('poll-question-input');
const pollOptionsContainer = document.getElementById('poll-options-container');
const btnAddPollOption = document.getElementById('btn-add-poll-option');
const pollMultiChoice = document.getElementById('poll-multi-choice');
const pollAnonymous = document.getElementById('poll-anonymous');
const btnCancelPoll = document.getElementById('btn-cancel-poll');
const btnConfirmPoll = document.getElementById('btn-confirm-poll');

// Reminder Modal
const reminderModalOverlay = document.getElementById('reminder-modal-overlay');
const btnCloseReminderModal = document.getElementById('btn-close-reminder-modal');
const reminderTitleInput = document.getElementById('reminder-title-input');
const reminderTimeInput = document.getElementById('reminder-time-input');
const btnCancelReminder = document.getElementById('btn-cancel-reminder');
const btnConfirmReminder = document.getElementById('btn-confirm-reminder');

// Profile Modal
const profileModalOverlay = document.getElementById('profile-modal-overlay');
const btnCloseProfileModal = document.getElementById('btn-close-profile-modal');
const profileAvatarBox = document.getElementById('profile-avatar-box');
const profileDisplayName = document.getElementById('profile-display-name');
const profileSubTitle = document.getElementById('profile-sub-title');
const profileUid = document.getElementById('profile-uid');
const profileZaloName = document.getElementById('profile-zalo-name');
const btnProfileCopyId = document.getElementById('btn-profile-copy-id');
const btnProfileSendMsg = document.getElementById('btn-profile-send-msg');

// Nạp danh sách các Nhóm Zalo, Bạn bè & danh sách Ghim từ main process
async function loadGroupsData(shouldRender = true) {
  if (window.electronAPI && window.electronAPI.getPinnedThreads) {
    try {
      const pins = await window.electronAPI.getPinnedThreads();
      if (Array.isArray(pins)) {
        pinnedThreadIds = new Set(pins);
      }
    } catch (e) {}
  }

  // Nạp danh sách các hội thoại tắt thông báo (Muted)
  if (window.electronAPI && window.electronAPI.getMutedThreads) {
    try {
      const mutes = await window.electronAPI.getMutedThreads();
      if (mutes && typeof mutes === 'object') {
        mutedThreadIds = new Set(Object.keys(mutes));
      }
    } catch (e) {}
  }

  let hasDataChange = false;

  // Nạp danh sách bạn bè
  if (window.electronAPI && window.electronAPI.getFriendsList) {
    try {
      let friends = await window.electronAPI.getFriendsList();
      if (!Array.isArray(friends) || friends.length === 0) {
        if (window.electronAPI.fetchFriendsList) {
          friends = await window.electronAPI.fetchFriendsList();
        }
      }
      if (Array.isArray(friends) && friends.length > 0) {
        allFriendsList = friends;
        hasDataChange = true;
      }
    } catch (e) {
      console.warn('Lỗi nạp danh sách bạn bè:', e);
    }
  }

  // Nạp danh sách nhóm
  if (window.electronAPI && window.electronAPI.getGroupsList) {
    try {
      const groups = await window.electronAPI.getGroupsList();
      if (Array.isArray(groups) && groups.length > 0) {
        allGroupsList = groups;
        hasDataChange = true;
      }
    } catch (e) {
      console.warn('Lỗi nạp danh sách nhóm ban đầu:', e);
    }
  }

  if (shouldRender && hasDataChange) {
    scheduleRenderFeed();
  }
  if (currentTab === 'tab-contacts') renderDirectory();
}

// Danh bạ dùng cùng dữ liệu cache với màn hội thoại
let directoryFilter = 'all';
function renderDirectory() {
  const list = document.getElementById('directory-list');
  const status = document.getElementById('directory-status');
  const search = document.getElementById('directory-search');
  if (!list || !status) return;
  const term = (search?.value || '').trim().toLocaleLowerCase('vi');
  const friends = (allFriendsList || []).map(friend => ({
    id: String(friend.userId || ''),
    name: friend.displayName || friend.zaloName || friend.name || 'Bạn bè Zalo',
    avatar: friend.avatar || '', isGroup: false
  })).filter(item => item.id);
  const groups = (allGroupsList || []).map(group => ({
    id: String(group.groupId || ''), name: group.name || 'Nhóm Zalo',
    avatar: group.avatar || '', isGroup: true, memberCount: group.totalMember || 0
  })).filter(item => item.id);
  const entries = (directoryFilter === 'friends' ? friends : directoryFilter === 'groups' ? groups : [...friends, ...groups])
    .filter(item => item.name.toLocaleLowerCase('vi').includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  list.replaceChildren();
  status.textContent = `${friends.length} bạn bè • ${groups.length} nhóm${term ? ` • ${entries.length} kết quả` : ''}`;
  if (!entries.length) {
    status.textContent = term ? 'Không tìm thấy. Hãy thử tên khác.' : 'Danh bạ trống. Hãy kết nối Zalo hoặc bấm Làm mới.';
    return;
  }
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'directory-item';
    const avatar = document.createElement('span');
    avatar.className = 'directory-avatar';
    if (entry.avatar) {
      const image = document.createElement('img');
      image.src = entry.avatar;
      image.alt = '';
      image.onerror = () => { avatar.textContent = entry.name[0].toUpperCase(); };
      avatar.appendChild(image);
    } else avatar.textContent = entry.name[0].toUpperCase();
    const body = document.createElement('span');
    body.className = 'directory-item-body';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const detail = document.createElement('small');
    detail.textContent = entry.isGroup ? `Nhóm • ${entry.memberCount} thành viên` : 'Bạn bè • Bấm để nhắn tin';
    body.append(name, detail);
    button.append(avatar, body);
    button.addEventListener('click', () => {
      activeThreadId = entry.id;
      messageFocusId = null;
      document.querySelector('[data-tab="tab-messages"]')?.click();
      renderDashboardFeed();
      markThreadAsRead(activeThreadId);
    });
    list.appendChild(button);
  }
}

document.querySelector('[data-tab="tab-contacts"]')?.addEventListener('click', renderDirectory);
document.getElementById('directory-search')?.addEventListener('input', renderDirectory);
document.querySelectorAll('[data-directory-filter]').forEach(button => button.addEventListener('click', () => {
  directoryFilter = button.dataset.directoryFilter;
  document.querySelectorAll('[data-directory-filter]').forEach(item => item.classList.toggle('active', item === button));
  renderDirectory();
}));
document.getElementById('btn-refresh-contacts')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Đang tải...';
  try {
    const [friends, groups] = await Promise.all([
      window.electronAPI.fetchFriendsList(), window.electronAPI.fetchGroupsList()
    ]);
    if (Array.isArray(friends)) allFriendsList = friends;
    if (Array.isArray(groups)) allGroupsList = groups;
    renderDirectory();
    renderDashboardFeed();
  } catch (error) {
    showToast(`Không thể làm mới danh bạ: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Làm mới';
  }
});

// Nhóm tin nhắn theo Thread ID và kết hợp với danh sách bạn bè & nhóm Zalo
function specificThreadName(name) {
  return name && name !== 'Bạn bè Zalo' && name !== 'Nhóm Zalo' ? name : '';
}

function getGroupedThreads() {
  const threadsMap = {};

  // Map bạn bè để tra cứu O(1)
  const friendsById = {};
  if (Array.isArray(allFriendsList)) {
    allFriendsList.forEach(f => {
      if (f && f.userId) {
        friendsById[String(f.userId)] = f;
      }
    });
  }

  // 1. Nhóm từ lịch sử tin nhắn thực tế
  messagesHistory.forEach(msg => {
    if (!msg || msg.isConversation || (msg.id && msg.id.startsWith('conv_'))) return;

    const tId = String(msg.threadId || msg.senderId || 'unknown');
    const isGrp = !!msg.isGroup;

    // Tìm thông tin bạn bè nếu là cá nhân
    const friendInfo = !isGrp ? friendsById[tId] : null;
    let initialName = '';
    let initialAvatar = '';

    if (isGrp) {
      initialName = msg.threadName || 'Nhóm Zalo';
      initialAvatar = msg.threadAvatar || '';
    } else {
      if (friendInfo) {
        initialName = specificThreadName(friendInfo.displayName) || specificThreadName(friendInfo.zaloName) || specificThreadName(msg.threadName);
        initialAvatar = friendInfo.avatar || '';
      } else {
        initialName = msg.threadName || (!msg.isSelf ? msg.senderName : 'Bạn bè Zalo');
        initialAvatar = msg.threadAvatar || (!msg.isSelf ? msg.avatar : '');
      }
    }

    if (!threadsMap[tId]) {
      threadsMap[tId] = {
        threadId: tId,
        senderName: initialName || (isGrp ? 'Nhóm Zalo' : 'Bạn bè Zalo'),
        avatar: initialAvatar || '',
        isGroup: isGrp,
        messages: []
      };
    }

    // Cập nhật tên và avatar chuẩn xác
    if (friendInfo) {
      const friendName = specificThreadName(friendInfo.displayName) || specificThreadName(friendInfo.zaloName);
      if (friendName) threadsMap[tId].senderName = friendName;
      else if (specificThreadName(msg.threadName)) threadsMap[tId].senderName = msg.threadName;
      if (friendInfo.avatar) threadsMap[tId].avatar = friendInfo.avatar;
    } else {
      if (msg.threadName) {
        threadsMap[tId].senderName = msg.threadName;
      } else if (!msg.isSelf && msg.senderName && msg.senderName !== 'Bạn (Tôi)') {
        threadsMap[tId].senderName = msg.senderName;
      }

      if (msg.threadAvatar) {
        threadsMap[tId].avatar = msg.threadAvatar;
      } else if (!msg.isSelf && msg.avatar) {
        threadsMap[tId].avatar = msg.avatar;
      }
    }

    threadsMap[tId].messages.push(msg);
  });

  // 2. Kết hợp với toàn bộ danh sách Nhóm Zalo (để các nhóm luôn hiển thị đầy đủ)
  if (Array.isArray(allGroupsList)) {
    allGroupsList.forEach(grp => {
      const gId = grp.groupId;
      if (!threadsMap[gId]) {
        threadsMap[gId] = {
          threadId: gId,
          senderName: grp.name || 'Nhóm Zalo',
          avatar: grp.avatar || '',
          isGroup: true,
          totalMember: grp.totalMember || 0,
          messages: [],
          lastMessage: {
            content: `[Nhóm • ${grp.totalMember || 0} thành viên]`,
            time: '',
            timestamp: 0
          }
        };
      } else {
        // Nhóm đã có tin nhắn: cập nhật thêm tên nhóm và avatar chính xác
        if (specificThreadName(grp.name)) threadsMap[gId].senderName = grp.name;
        if (grp.avatar) threadsMap[gId].avatar = grp.avatar;
        threadsMap[gId].totalMember = grp.totalMember || 0;
        threadsMap[gId].isGroup = true;
      }
    });
  }

  // 3. Kết hợp với toàn bộ danh sách bạn bè để đồng bộ tên và avatar
  if (Array.isArray(allFriendsList)) {
    allFriendsList.forEach(fr => {
      const uId = String(fr.userId);
      // Chỉ hiển thị bạn bè chưa có tin nhắn khi người dùng đang tìm kiếm, hoặc đang xem hội thoại này, hoặc đã ghim
      const shouldInclude = !!searchQuery || (activeThreadId && uId === String(activeThreadId)) || pinnedThreadIds.has(uId);
      if (!threadsMap[uId]) {
        if (shouldInclude) {
          threadsMap[uId] = {
            threadId: uId,
            senderName: fr.displayName || fr.zaloName || 'Bạn bè Zalo',
            avatar: fr.avatar || '',
            isGroup: false,
            messages: [],
            lastMessage: {
              content: '[Chưa có tin nhắn]',
              time: '',
              timestamp: 0
            }
          };
        }
      } else {
        const friendName = specificThreadName(fr.displayName) || specificThreadName(fr.zaloName);
        if (friendName) threadsMap[uId].senderName = friendName;
        if (fr.avatar) threadsMap[uId].avatar = fr.avatar;
      }
    });
  }

  // Cập nhật số lượng nhóm lên badge của nút lọc Nhóm
  if (groupFilterCount) {
    const totalGroups = Object.values(threadsMap).filter(t => t.isGroup).length;
    groupFilterCount.textContent = totalGroups;
  }

  // Sắp xếp tin nhắn trong mỗi thread từ cũ đến mới (chuẩn timeline chat)
  Object.values(threadsMap).forEach(thread => {
    thread.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (thread.messages.length > 0) {
      thread.lastMessage = thread.messages[thread.messages.length - 1];
    }
  });

  // Thêm mục Cloud của tôi (Truyền File) luôn luôn hiện diện ở đầu
  const CLOUD_ID = myCloudId || 'my_cloud';
  if (!threadsMap[CLOUD_ID]) {
    threadsMap[CLOUD_ID] = {
      threadId: CLOUD_ID,
      senderName: 'Cloud của tôi',
      avatar: 'cloud',
      isGroup: false,
      isCloud: true,
      messages: [],
      lastMessage: {
        content: 'Truyền File và lưu trữ ghi chú cá nhân',
        time: '',
        timestamp: 0
      }
    };
  } else {
    threadsMap[CLOUD_ID].senderName = 'Cloud của tôi';
    threadsMap[CLOUD_ID].avatar = 'cloud';
    threadsMap[CLOUD_ID].isCloud = true;
  }

  // Lọc theo chế độ tab: Tất cả / Cá nhân / Nhóm
  let list = Object.values(threadsMap);
  if (currentFilter === 'user') {
    list = list.filter(t => !t.isGroup);
  } else if (currentFilter === 'group') {
    list = list.filter(t => t.isGroup);
  } else if (currentFilter === 'pinned') {
    list = list.filter(t => pinnedThreadIds.has(String(t.threadId)));
  }

  // Sắp xếp: Cloud của tôi lên đầu tiên -> Hội thoại ghim -> Hội thoại có tin nhắn mới nhất
  return list.sort((a, b) => {
    if (a.isCloud) return -1;
    if (b.isCloud) return 1;

    const isPinnedA = pinnedThreadIds.has(String(a.threadId)) ? 1 : 0;
    const isPinnedB = pinnedThreadIds.has(String(b.threadId)) ? 1 : 0;
    if (isPinnedA !== isPinnedB) return isPinnedB - isPinnedA;

    const tsA = (a.lastMessage && a.lastMessage.timestamp) || 0;
    const tsB = (b.lastMessage && b.lastMessage.timestamp) || 0;
    if (tsA !== tsB) return tsB - tsA;
    return (a.senderName || '').localeCompare(b.senderName || '', 'vi');
  });
}

// Render toàn bộ giao diện hội thoại 2 cột
function renderDashboardFeed() {
  const threads = getGroupedThreads();
  if (pinnedConversationsCount) pinnedConversationsCount.textContent = String(pinnedThreadIds.size);
  pinnedConversationsFilter?.classList.toggle('active', currentFilter === 'pinned');

  if (threads.length === 0) {
    if (conversationList) {
      const emptyMsg = currentFilter === 'group'
        ? 'Chưa có nhóm nào. Bấm "Làm mới Nhóm" ở trên để tải danh sách nhóm Zalo!'
        : (currentFilter === 'user' ? 'Chưa có cuộc trò chuyện cá nhân nào'
          : (currentFilter === 'pinned' ? 'Chưa ghim người hoặc nhóm nào. Nhấp chuột phải vào một hội thoại để ghim.'
            : 'Chưa có cuộc trò chuyện nào'));
      conversationList.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: #64748B; font-size: 13px;">${emptyMsg}</div>`;
    }
    if (chatMessagesScroll) {
      chatMessagesScroll.innerHTML = `
        <div class="empty-feed" id="feed-empty">
          <div class="empty-icon-lg">💬</div>
          <h3>Chưa có cuộc trò chuyện nào</h3>
          <p>Khi có người nhắn tin hoặc bấm "Làm mới Nhóm", các cuộc trò chuyện sẽ hiển thị tại đây!</p>
        </div>
      `;
    }
    if (activeChatName) activeChatName.textContent = 'Chưa có cuộc hội thoại';
    if (activeChatType) activeChatType.textContent = 'Trống';
    if (activeChatCount) activeChatCount.textContent = '0 tin nhắn';
    return;
  }

  // Tự động chọn cuộc trò chuyện đầu tiên nếu chưa chọn hoặc id không còn tồn tại
  const previousThreadId = activeThreadId;
  if (!activeThreadId || !threads.some(t => String(t.threadId) === String(activeThreadId))) {
    activeThreadId = String(threads[0].threadId);
  }

  // 1. Render cột bên trái (Danh sách người nhắn tin và nhóm)
  renderConversationList(threads);

  // 2. Render cột bên phải (Nội dung chi tiết của hội thoại đang chọn)
  renderActiveChatThread(threads);
  if (String(previousThreadId || '') !== String(activeThreadId)) {
    markThreadAsRead(activeThreadId);
  }
}

// Render danh sách hội thoại bên trái
const CONVERSATION_ROW_HEIGHT = 70;
let virtualConversationThreads = [];
let virtualConversationAllThreads = [];
let virtualConversationRange = '';
let virtualConversationFilter = '';
let virtualConversationRAF = null;

function renderConversationList(threads) {
  if (!conversationList) return;

  const filtered = searchQuery
    ? threads.filter(t => t.senderName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (t.lastMessage && t.lastMessage.content && t.lastMessage.content.toLowerCase().includes(searchQuery.toLowerCase())))
    : threads;

  const filterKey = `${currentFilter}:${searchQuery}`;
  if (filterKey !== virtualConversationFilter) conversationList.scrollTop = 0;
  virtualConversationFilter = filterKey;
  virtualConversationThreads = filtered;
  virtualConversationAllThreads = threads;
  renderVisibleConversationRows(true);
}

function renderVisibleConversationRows(force = false) {
  if (!conversationList) return;
  const filtered = virtualConversationThreads;
  const scrollTop = conversationList.scrollTop;
  const range = window.LazyHistory.getVirtualRange(filtered.length, scrollTop,
    conversationList.clientHeight || 700, CONVERSATION_ROW_HEIGHT, 8);
  const rangeKey = `${range.start}:${range.end}:${filtered.length}`;
  if (!force && rangeKey === virtualConversationRange) return;
  virtualConversationRange = rangeKey;
  conversationList.replaceChildren();

  if (filtered.length === 0) {
    conversationList.innerHTML = '<div style="padding: 24px 14px; text-align: center; color: #64748B; font-size: 12.5px;">Không tìm thấy kết quả phù hợp</div>';
    return;
  }

  const topSpacer = document.createElement('div');
  topSpacer.className = 'conv-virtual-spacer';
  topSpacer.style.height = `${range.top}px`;
  conversationList.appendChild(topSpacer);

  filtered.slice(range.start, range.end).forEach((thread, offset) => {
    const item = document.createElement('div');
    const isActive = String(thread.threadId) === String(activeThreadId);
    const isPinned = pinnedThreadIds.has(String(thread.threadId));
    const isMuted = mutedThreadIds.has(String(thread.threadId)) || (thread.lastMessage && thread.lastMessage.isMuted);
    const isCloud = !!thread.isCloud;
    item.className = 'conv-item' + (isActive ? ' active' : '') + (isCloud ? ' cloud-item' : '');
    item.setAttribute('data-thread-id', thread.threadId);
    item.dataset.conversationIndex = String(range.start + offset);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Mở hội thoại ${thread.senderName}`);

    const initial = (thread.senderName || 'Z')[0].toUpperCase();
    const avatarHtml = isCloud
      ? `<span style="font-size: 19px;">☁️</span>`
      : (thread.avatar
        ? `<img src="${escapeHTML(thread.avatar)}" class="conv-avatar-img" onerror="this.style.display='none';">`
        : `<span class="conv-avatar-letter">${escapeHTML(initial)}</span>`);

    const lastMsg = thread.lastMessage || {};
    const lastContent = window.CallMessage.describeCallMessage(lastMsg) || (thread.isGroup ? `[Nhóm • ${thread.totalMember || 0} thành viên]` : '[Chưa có tin nhắn]');
    const lastTime = lastMsg.time || '';

    item.innerHTML = `
      <div class="conv-avatar-wrap">
        <div class="conv-avatar" style="${isCloud ? 'background: linear-gradient(135deg, #0084FF 0%, #0052CC 100%);' : (thread.isGroup ? 'background: linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%);' : '')}">${avatarHtml}</div>
      </div>
      <div class="conv-body">
        <div class="conv-top-row">
          <span class="conv-name" title="${escapeHTML(thread.senderName)}">
            ${isPinned ? '<span class="conv-pinned-badge" title="Đã ghim">📌</span>' : ''}
            ${escapeHTML(thread.senderName)}
            ${isCloud ? '<span class="cloud-badge-tag">Truyền File</span>' : ''}
            ${isMuted ? '<span class="conv-mute-badge" title="Đã tắt thông báo"><img src="../assets/zalo-icons/icon-mute.svg" alt="Tắt thông báo"></span>' : ''}
          </span>
          <span class="conv-time">${escapeHTML(lastTime)}</span>
        </div>
        <div class="conv-bottom-row">
          <span class="conv-preview" title="${escapeHTML(lastContent)}">${escapeHTML(lastContent)}</span>
          <span class="conv-tag ${thread.isGroup ? 'group' : ''}">${isCloud ? 'Lưu trữ' : (thread.isGroup ? 'Nhóm' : 'Cá nhân')}</span>
          ${thread.isGroup && thread.totalMember ? `<span class="conv-member-count">👥 ${thread.totalMember}</span>` : ''}
          ${(() => {
            const unreadCount = getThreadUnreadCount(thread);
            return unreadCount > 0 ? `<span class="conv-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
          })()}
        </div>
      </div>
      <div class="conv-item-actions">
        ${!isCloud ? `
        <button class="conv-action-btn conv-mute-btn ${isMuted ? 'is-muted' : ''}" title="${isMuted ? 'Bật lại thông báo' : 'Tắt thông báo'}">
          ${isMuted ? '<img src="../assets/zalo-icons/icon-mute.svg" width="11" height="11" style="display:block;">' : '🔔'}
        </button>
        <button class="conv-action-btn conv-pin-btn ${isPinned ? 'is-pinned' : ''}" title="${isPinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu'}">
          ${isPinned ? '📌' : '📍'}
        </button>
        ` : ''}
      </div>
    `;

    // Bắt sự kiện click chuột phải (Context Menu) cho từng cuộc trò chuyện
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (typeof showConvContextMenu === 'function') {
        showConvContextMenu(e, thread);
      }
    });

    // Bắt sự kiện tắt / bật thông báo (Mute)
    const muteBtn = item.querySelector('.conv-mute-btn');
    if (muteBtn) {
      muteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextMuted = !isMuted;
        try {
          const result = await window.electronAPI.setThreadMute(thread.threadId, nextMuted, thread.isGroup, -1);
          if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
          if (nextMuted) mutedThreadIds.add(String(thread.threadId));
          else mutedThreadIds.delete(String(thread.threadId));
          showToast(nextMuted ? `Đã tắt thông báo "${thread.senderName}"` : `Đã bật thông báo "${thread.senderName}"`, 'success');
          renderDashboardFeed();
        } catch (err) {
          showToast(`Không thể đổi thông báo: ${err.message}`, 'error');
        }
      });
    }

    // Bắt sự kiện ghim
    const pinBtn = item.querySelector('.conv-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextPinned = !isPinned;
        try {
          const result = await window.electronAPI.setPinnedConversation(thread.threadId, nextPinned, thread.isGroup);
          if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
          if (nextPinned) pinnedThreadIds.add(String(thread.threadId));
          else pinnedThreadIds.delete(String(thread.threadId));
          showToast(nextPinned ? `Đã ghim "${thread.senderName}"` : `Đã bỏ ghim "${thread.senderName}"`, 'success');
          renderDashboardFeed();
        } catch (err) {
          showToast(`Không thể đổi trạng thái ghim: ${err.message}`, 'error');
        }
      });
    }

    // Bắt sự kiện Click vào cuộc trò chuyện: Đánh dấu đã xem và chuyển tức thì (0ms, không đơ)
    item.addEventListener('click', () => {
      const newThreadId = String(thread.threadId);
      if (activeThreadId === newThreadId) return; // Đang xem hội thoại này rồi, không nháy lại

      activeThreadId = newThreadId;
      messageFocusId = null;
      messagesHistory = window.LazyHistory.retainActiveThreadMessages(messagesHistory, activeThreadId);
      for (const key of [...threadHistoryLoaded]) if (key !== activeThreadId) threadHistoryLoaded.delete(key);
      markThreadAsRead(thread.threadId); // Lưu local: đã xem, không hiển thị số tin nhắn nữa

      // Cập nhật class active trên danh sách mà không cần build lại toàn bộ sidebar
      const prevActive = conversationList.querySelector('.conv-item.active');
      if (prevActive) prevActive.classList.remove('active');
      item.classList.add('active');

      // Xóa badge tin nhắn chưa đọc
      const badge = item.querySelector('.conv-badge');
      if (badge) badge.remove();

      // Render nội dung tin nhắn ngay lập tức (0ms độ trễ, không đơ lag)
      renderActiveChatThread(virtualConversationAllThreads);
    });
    item.addEventListener('keydown', (event) => {
      if (event.target !== item) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, Math.min(filtered.length - 1,
          Number(item.dataset.conversationIndex) + (event.key === 'ArrowDown' ? 1 : -1)));
        const viewportTop = conversationList.scrollTop;
        const targetTop = next * CONVERSATION_ROW_HEIGHT;
        if (targetTop < viewportTop) conversationList.scrollTop = targetTop;
        else if (targetTop + CONVERSATION_ROW_HEIGHT > viewportTop + conversationList.clientHeight) {
          conversationList.scrollTop = targetTop + CONVERSATION_ROW_HEIGHT - conversationList.clientHeight;
        }
        renderVisibleConversationRows(true);
        conversationList.querySelector(`[data-conversation-index="${next}"]`)?.focus();
      }
    });

    conversationList.appendChild(item);
  });
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'conv-virtual-spacer';
  bottomSpacer.style.height = `${range.bottom}px`;
  conversationList.appendChild(bottomSpacer);
  conversationList.scrollTop = scrollTop;
}

conversationList?.addEventListener('scroll', () => {
  if (virtualConversationRAF) return;
  virtualConversationRAF = requestAnimationFrame(() => {
    virtualConversationRAF = null;
    renderVisibleConversationRows();
  });
});

// Render toàn bộ tin nhắn của cuộc hội thoại đang chọn ở cột phải có scroll
function renderActiveChatThread(threads) {
  if (!threads) threads = getGroupedThreads();
  const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId)) || threads[0];
  if (!currentThread) return;
  linkPreviewObserver?.disconnect();
  linkPreviewObserver = null;
  resolveVisibleGroupSenders(currentThread);
  if (currentThread.messages.length < 50) loadRecentThreadHistory(currentThread.threadId);
  if (currentThread.isCloud && currentThread.messages.length > 0) refreshCloudRecent();

  // Tự động đồng bộ Panel Thông tin hội thoại bên phải nếu đang mở
  if (typeof isInfoPanelOpen !== 'undefined' && isInfoPanelOpen && typeof renderConversationInfoPanel === 'function') {
    renderConversationInfoPanel();
  }

  // Tự động đồng bộ Thanh Ghim Tin Nhắn (Pinned Message Bar)
  if (typeof renderPinnedMessageBar === 'function') {
    renderPinnedMessageBar(currentThread);
    loadServerPinnedMessages(currentThread);
  }

  // Cập nhật Header
  if (currentThread.isCloud) {
    if (activeChatName) activeChatName.innerHTML = 'Cloud của tôi <span class="cloud-badge-tag">Truyền File</span>';
    if (activeChatType) activeChatType.textContent = 'Truyền File • Lưu trữ cá nhân';
    if (activeChatCount) activeChatCount.textContent = `${currentThread.messages.length} ghi chú/tệp`;
    if (activeChatAvatar) {
      activeChatAvatar.innerHTML = '<span style="font-size: 20px;">☁️</span>';
      activeChatAvatar.style.background = 'linear-gradient(135deg, #0084FF 0%, #0052CC 100%)';
    }
  } else {
    if (activeChatName) activeChatName.textContent = currentThread.senderName;
    if (activeChatType) {
      activeChatType.textContent = currentThread.isGroup 
        ? `Nhóm Zalo • ${currentThread.totalMember || 0} thành viên`
        : 'Tin nhắn Cá nhân';
    }
    if (activeChatCount) activeChatCount.textContent = `${currentThread.messages.length} tin đã tải`;

    const initial = (currentThread.senderName || 'Z')[0].toUpperCase();
    if (activeChatAvatar) {
      activeChatAvatar.innerHTML = currentThread.avatar
        ? `<img src="${escapeHTML(currentThread.avatar)}" class="conv-avatar-img" onerror="this.style.display='none';">`
        : `<span class="conv-avatar-letter">${escapeHTML(initial)}</span>`;
      activeChatAvatar.style.background = currentThread.isGroup
        ? 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
        : 'linear-gradient(135deg, #0084FF 0%, #0052CC 100%)';
    }
  }

  // Cập nhật trạng thái nút Tắt / Bật thông báo trên Header
  const isMuted = mutedThreadIds.has(String(currentThread.threadId));
  if (btnToggleMuteChat) {
    btnToggleMuteChat.classList.toggle('is-muted', isMuted);
    btnToggleMuteChat.title = isMuted 
      ? `Đang tắt thông báo "${currentThread.senderName}". Bấm để bật lại âm thanh thông báo.` 
      : `Đang bật thông báo "${currentThread.senderName}". Bấm để tắt thông báo (Im lặng).`;
    if (iconMuteHeader) iconMuteHeader.style.display = isMuted ? 'inline-block' : 'none';
    if (iconBellHeader) iconBellHeader.style.display = isMuted ? 'none' : 'inline-block';
  }

  // Cập nhật nút Bình chọn và Nhắc hẹn trên Header
  if (btnToggleGroupPoll) {
    btnToggleGroupPoll.style.display = currentThread.isGroup ? 'inline-block' : 'none';
  }
  if (btnToggleGroupReminder) {
    btnToggleGroupReminder.style.display = !currentThread.isCloud ? 'inline-block' : 'none';
  }

  // Bắt sự kiện click vào Avatar Header để xem Hồ sơ bạn bè
  if (activeChatAvatar) {
    activeChatAvatar.style.cursor = (!currentThread.isGroup && !currentThread.isCloud) ? 'pointer' : 'default';
    activeChatAvatar.onclick = () => {
      if (!currentThread.isGroup && !currentThread.isCloud && typeof openProfileModal === 'function') {
        openProfileModal({
          userId: currentThread.threadId,
          name: currentThread.senderName,
          avatar: currentThread.avatar
        });
      }
    };
  }

  // Render danh sách tin nhắn có scroll
  if (!chatMessagesScroll) return;
  chatMessagesScroll.innerHTML = '';

  // Nếu là nhóm hoặc cuộc hội thoại chưa có tin nhắn nào
  if (currentThread.messages.length === 0) {
    chatMessagesScroll.innerHTML = `
      <div class="empty-feed" style="margin: auto; max-width: 420px; text-align: center; padding: 40px 20px;">
        <div class="empty-icon-lg" style="font-size: 48px; margin-bottom: 12px;">${currentThread.isGroup ? '👥' : '💬'}</div>
        <h3 style="color: #F8FAFC; margin-bottom: 6px;">${escapeHTML(currentThread.senderName)}</h3>
        <p style="color: #94A3B8; font-size: 13px;">${currentThread.isGroup ? `Nhóm Zalo gồm ${currentThread.totalMember || 0} thành viên.` : 'Cuộc trò chuyện Zalo cá nhân'}</p>
        <p style="color: #64748B; font-size: 12.5px; margin-top: 8px;">Chưa có lịch sử tin nhắn lưu trữ trên máy.</p>
        <button id="btn-fetch-current-thread" class="btn btn-secondary" style="margin-top: 14px; font-size: 13px; padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #38BDF8; cursor: pointer;">
          📥 Tải tin nhắn gần đây từ máy chủ Zalo
        </button>
      </div>
    `;

    const btnFetch = document.getElementById('btn-fetch-current-thread');
    if (btnFetch) {
      btnFetch.addEventListener('click', async () => {
        btnFetch.disabled = true;
        btnFetch.textContent = 'Đang tải tin nhắn...';
        if (window.electronAPI && window.electronAPI.fetchThreadMessages) {
          try {
            const local = window.electronAPI.getThreadHistory
              ? await window.electronAPI.getThreadHistory(currentThread.threadId, 50, 0) : [];
            const fetched = local.length > 0
              ? local
              : await window.electronAPI.fetchThreadMessages(currentThread.threadId, currentThread.isGroup);
            if (Array.isArray(fetched) && fetched.length > 0) {
              fetched.forEach(m => addMessageToDashboard(m, true));
              renderDashboardFeed();
              showToast(`Đã tải ${fetched.length} tin nhắn!`, 'success');
            } else {
              showToast('Hiện không có thêm tin nhắn nào trên máy chủ Zalo', 'info');
              btnFetch.disabled = false;
              btnFetch.textContent = '📥 Thử tải lại';
            }
          } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
            btnFetch.disabled = false;
            btnFetch.textContent = '📥 Thử tải lại';
          }
        }
      });
    }
    return;
  }

  const visibleCount = threadVisibleCounts.get(String(currentThread.threadId)) || 100;
  const focusIndex = messageFocusId && String(currentThread.threadId) === String(activeThreadId)
    ? currentThread.messages.findIndex(m => String(m.id) === String(messageFocusId)) : -1;
  const visibleMessages = focusIndex >= 0
    ? currentThread.messages.slice(Math.max(0, focusIndex - 50), focusIndex + 51)
    : currentThread.messages.slice(-visibleCount);

  if (focusIndex >= 0) {
    const backToLatest = document.createElement('button');
    backToLatest.type = 'button';
    backToLatest.className = 'chat-history-more';
    backToLatest.textContent = 'Về tin mới nhất';
    backToLatest.addEventListener('click', () => {
      messageFocusId = null;
      renderActiveChatThread();
    });
    chatMessagesScroll.appendChild(backToLatest);
  } else if (!threadHistoryExhausted.has(String(currentThread.threadId))) {
    const loadOlder = document.createElement('button');
    loadOlder.type = 'button';
    loadOlder.className = 'chat-history-more';
    loadOlder.textContent = 'Tải tin nhắn cũ hơn';
    loadOlder.addEventListener('click', async () => {
      loadOlder.disabled = true;
      loadOlder.textContent = 'Đang tải...';
      const threadKey = String(currentThread.threadId);
      if (currentThread.messages.length > visibleCount) {
        threadVisibleCounts.set(threadKey, visibleCount + 50);
        renderActiveChatThread();
        return;
      }
      try {
        let older = await window.electronAPI.getThreadHistory(threadKey, 50, currentThread.messages.length);
        if (older.length === 0 && currentThread.isCloud && window.electronAPI.fetchCloudMessages) {
          const cursor = cloudOlderCursor.get(threadKey) || String(currentThread.messages[0]?.id || '0');
          const cloud = await window.electronAPI.fetchCloudMessages(cursor, true);
          older = cloud.messages || [];
          if (cloud.hasMore && cloud.lastMsgId && cloud.lastMsgId !== cursor) cloudOlderCursor.set(threadKey, cloud.lastMsgId);
          else threadHistoryExhausted.add(threadKey);
        }
        if (older.length === 0) {
          if (!currentThread.isCloud) threadHistoryExhausted.add(threadKey);
        } else {
          threadVisibleCounts.set(threadKey, visibleCount + older.length);
          older.forEach(m => addMessageToDashboard(m, true));
        }
        renderActiveChatThread();
      } catch (error) {
        loadOlder.disabled = false;
        loadOlder.textContent = 'Tải tin nhắn cũ hơn';
        showToast(`Không thể tải lịch sử: ${error.message}`, 'error');
      }
    });
    chatMessagesScroll.appendChild(loadOlder);
  }

  visibleMessages.forEach(msg => {
    const row = document.createElement('div');
    const isSelf = !!msg.isSelf;
    row.className = 'chat-msg-row ' + (isSelf ? 'self' : 'other');
    row.setAttribute('data-msg-id', msg.id || ('cli_' + (msg.cliMsgId || '')));
    if (currentThread.isGroup && !isSelf) row.dataset.senderId = String(msg.senderId || '');

    const groupSenderName = msg.senderName || (currentThread.isGroup && !isSelf
      ? `Thành viên • ${String(msg.senderId || '').slice(-4) || '?'}` : '');
    const msgInitial = (groupSenderName || 'Z')[0].toUpperCase();
    const avatarHtml = !isSelf
      ? `<div class="chat-msg-avatar">
          ${msg.avatar ? `<img src="${escapeHTML(msg.avatar)}" class="conv-avatar-img" onerror="this.style.display='none';">` : escapeHTML(msgInitial)}
         </div>`
      : '';

    const senderHeaderHtml = (!isSelf && currentThread.isGroup)
      ? `<span class="chat-msg-sender">${escapeHTML(groupSenderName)}</span>`
      : '';

    const quoteHtml = msg.quote ? `
      <div class="chat-quote-bubble">
        <div class="chat-quote-sender">↩️ ${escapeHTML(msg.quote.senderName || 'Người nhận')}</div>
        <div class="chat-quote-msg">${escapeHTML(msg.quote.content || '')}</div>
      </div>
    ` : '';

    const reactionSvgMap = {
      '❤️': '../assets/zalo-icons/Heart_24_emoji.svg',
      '/-heart': '../assets/zalo-icons/Heart_24_emoji.svg',
      '5': '../assets/zalo-icons/Heart_24_emoji.svg',
      '👍': '../assets/zalo-icons/Like_24_emoji.svg',
      '/-strong': '../assets/zalo-icons/Like_24_emoji.svg',
      '3': '../assets/zalo-icons/Like_24_emoji.svg',
      '😂': '../assets/zalo-icons/Smile_24_emoji.svg',
      ':>': '../assets/zalo-icons/Smile_24_emoji.svg',
      '0': '../assets/zalo-icons/Smile_24_emoji.svg',
      '😮': '../assets/zalo-icons/Surprised_24_emoji.svg',
      ':o': '../assets/zalo-icons/Surprised_24_emoji.svg',
      '32': '../assets/zalo-icons/Surprised_24_emoji.svg',
      '😢': '../assets/zalo-icons/Cry_24_emoji.svg',
      ':-((': '../assets/zalo-icons/Cry_24_emoji.svg',
      '2': '../assets/zalo-icons/Cry_24_emoji.svg',
      '😡': '../assets/zalo-icons/Rage_24_emoji.svg',
      ':-h': '../assets/zalo-icons/Rage_24_emoji.svg',
      '20': '../assets/zalo-icons/Rage_24_emoji.svg'
    };
    const reactionEmojiMap = {
      '/-heart': '❤️', '5': '❤️',
      '/-strong': '👍', '3': '👍',
      ':>': '😂', '0': '😂',
      ':o': '😮', '32': '😮',
      ':-((': '😢', '2': '😢',
      ':-h': '😡', '20': '😡'
    };

    const hasReactions = Array.isArray(msg.reactions) && msg.reactions.length > 0;
    const reactionsHtml = hasReactions
      ? `<div class="chat-bubble-reactions">
          ${msg.reactions.map(r => {
            const rawIcon = String(r.icon || '❤️');
            const svgPath = reactionSvgMap[rawIcon] || reactionSvgMap[reactionEmojiMap[rawIcon]];
            const displayEmoji = reactionEmojiMap[rawIcon] || rawIcon;
            const iconContent = svgPath
              ? `<img src="${svgPath}" alt="${escapeHTML(displayEmoji)}" class="reaction-pill-svg">`
              : escapeHTML(displayEmoji);
            return `<span class="reaction-pill" title="${escapeHTML(r.senderName || '')}">${iconContent}</span>`;
          }).join('')}
         </div>`
      : '';

    // Kiểm tra tin nhắn bị thu hồi (kể cả người khác thu hồi hoặc mình thu hồi)
    const isRevokedMsg = Boolean(
      msg.isUndo || 
      msg.isRevoked || 
      msg.isRecalled || 
      msg.content === 'Tin nhắn đã được thu hồi' || 
      msg.content === '[Tin nhắn đã bị xóa]' || 
      (typeof msg.content === 'string' && (msg.content.includes('Tin nhắn đã được thu hồi') || msg.content.includes('Tin nhắn đã bị thu hồi')))
    );

    // Xác định nội dung hiển thị: Thu hồi, Ảnh, Sticker, Video, Tệp tin, Bình chọn (Poll), Nhắc hẹn (Reminder) hay Text
    let msgBodyHtml = '';
    const isPhotoMsg = !isRevokedMsg && (msg.isPhoto || (typeof msg.content === 'string' && (msg.content.match(/^https?:\/\/[^\s]+(\.(jpg|jpeg|png|webp|gif)|\/jpg\/|\/png\/)/i) || msg.content.includes('.zdn.vn/'))));
    const isStickerMsg = !isRevokedMsg && (msg.isSticker || !!msg.stickerUrl);
    const isVideoMsg = !isRevokedMsg && (msg.isVideo || (typeof msg.content === 'string' && msg.content.match(/^https?:\/\/[^\s]+(\.mp4|\.mov|video-stal|dlmd\.me)/i)));
    const isFileMsg = !isRevokedMsg && (msg.isFile || !!msg.fileUrl || (typeof msg.content === 'string' && msg.content.startsWith('[Tài liệu:')));
    const isPollMsg = !isRevokedMsg && (msg.isPoll || !!msg.pollData || (typeof msg.content === 'string' && msg.content.startsWith('[Bình chọn:')));
    const isReminderMsg = !isRevokedMsg && (msg.isReminder || !!msg.reminderData || (typeof msg.content === 'string' && msg.content.startsWith('[Nhắc hẹn:')));
    const linkUrl = !isRevokedMsg ? window.LinkPreview.getMessageUrl(msg) : '';
    const voice = !isRevokedMsg ? window.VoiceMessage.getVoicePresentation(msg) : { isVoice: false };

    if (isRevokedMsg) {
      msgBodyHtml = `
        <div class="chat-bubble ${isSelf ? 'self' : 'other'} revoked-bubble" title="Tin nhắn này đã bị người gửi thu hồi">
          <span class="revoked-icon">🚫</span>
          <span class="revoked-text">Tin nhắn đã được thu hồi</span>
        </div>
      `;
    } else if (voice.isVoice) {
      msgBodyHtml = `
        <div class="chat-bubble ${isSelf ? 'self' : 'other'} chat-voice-bubble">
          <span class="chat-voice-icon" aria-hidden="true">🎤</span>
          <div class="chat-voice-content">
            <span class="chat-voice-title">Tin nhắn thoại${voice.duration ? ` • ${escapeHTML(voice.duration)}` : ''}</span>
            ${voice.url
              ? `<audio controls preload="none" src="${escapeHTML(voice.url)}" aria-label="Phát tin nhắn thoại"></audio>`
              : '<span class="chat-voice-unavailable">Chưa có tệp âm thanh trong lịch sử đã đồng bộ</span>'}
          </div>
        </div>
      `;
    } else if (isPollMsg) {
      const poll = msg.pollData || parsePollContent(msg.content);
      const totalVotes = (poll.options || []).reduce((sum, o) => sum + (o.votes || 0), 0);
      msgBodyHtml = `
        <div class="chat-poll-card" data-poll-id="${escapeHTML(msg.id)}">
          <div class="poll-header">
            <span class="poll-badge">📊 BÌNH CHỌN</span>
            <span style="font-size: 11px; color: #94A3B8;">${poll.isAnonymous ? 'Ẩn danh' : 'Công khai'}</span>
          </div>
          <div class="poll-question">${escapeHTML(poll.question || 'Bình chọn ý kiến')}</div>
          <div class="poll-options-list">
            ${(poll.options || []).map((opt, optIdx) => {
              const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
              const isVoted = Array.isArray(opt.voters) && opt.voters.includes('me');
              return `
                <div class="poll-option-item ${isVoted ? 'voted' : ''}" data-opt-idx="${optIdx}" title="Bấm để bình chọn">
                  <div class="poll-option-progress" style="width: ${pct}%;"></div>
                  <span class="poll-option-text">${isVoted ? '✓ ' : ''}${escapeHTML(opt.text)}</span>
                  <span class="poll-option-stats">${opt.votes || 0} (${pct}%)</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="poll-card-footer">
            <span>Tổng cộng: ${totalVotes} lượt bình chọn</span>
            <span style="color: #38BDF8; font-weight: 600;">Nhấp để vote</span>
          </div>
        </div>
      `;
    } else if (isReminderMsg) {
      const reminder = msg.reminderData || parseReminderContent(msg.content);
      msgBodyHtml = `
        <div class="chat-reminder-card">
          <div class="reminder-header">
            <span style="font-size: 18px;">${escapeHTML(reminder.emoji || '⏰')}</span>
            <span class="reminder-title">${escapeHTML(reminder.title || 'Lịch nhắc hẹn')}</span>
          </div>
          <div class="reminder-time-box">
            <span>📅</span>
            <span>${escapeHTML(reminder.timeStr || reminder.time || 'Thời gian đã lên lịch')}</span>
          </div>
        </div>
      `;
    } else if (isStickerMsg) {
      const sUrl = msg.stickerUrl || `https://api.zaloapp.com/api/emoticon/sticker/webpc?eid=${msg.stickerId || 16715}&size=260`;
      msgBodyHtml = `
        <div class="chat-msg-sticker-wrap">
          <img src="${escapeHTML(sUrl)}" class="chat-msg-sticker" alt="Sticker Zalo" loading="lazy">
        </div>
      `;
    } else if (isPhotoMsg) {
      const pUrl = msg.photoUrl || msg.thumbUrl || msg.content;
      const photoCaption = window.PhotoCaption.getPhotoCaption(msg);
      msgBodyHtml = `
        <div class="chat-msg-img-wrap ${photoCaption ? 'has-caption' : ''}" data-img-src="${escapeHTML(pUrl)}">
          <div class="chat-msg-image-surface">
            <img src="${escapeHTML(pUrl)}" class="chat-msg-img" loading="lazy" alt="Hình ảnh Zalo" onerror="this.onerror=null; this.src='../assets/zalo-icons/icon-photo.svg';">
            <div class="chat-img-overlay-btn">🔍 Xem ảnh</div>
          </div>
          ${photoCaption ? `<div class="chat-photo-caption">${escapeHTML(photoCaption)}</div>` : ''}
        </div>
      `;
    } else if (isVideoMsg) {
      const vUrl = msg.videoUrl || msg.content;
      msgBodyHtml = `
        <video src="${escapeHTML(vUrl)}" class="chat-msg-video" controls></video>
      `;
    } else if (isFileMsg) {
      let fName = msg.fileName || '';
      if (!fName || fName === 'Tài liệu Zalo' || fName === 'Tệp tin Zalo' || !fName.includes('.')) {
        if (typeof msg.content === 'string') {
          const clean = msg.content.replace(/^\[Tài liệu:\s*|\]$/g, '').trim();
          if (clean.includes('.')) fName = clean;
        }
      }
      if (!fName && msg.fileUrl) {
        const rawPart = msg.fileUrl.split('/').pop().split('?')[0];
        if (rawPart && rawPart.includes('.')) fName = decodeURIComponent(rawPart);
      }
      if (!fName) fName = 'Tài liệu đính kèm';

      const fUrl = msg.fileUrl || '';
      const localSavedPath = downloadedFilePaths.get(fUrl);
      const isSaved = Boolean(localSavedPath);
      const fExt = (fName.split('.').pop() || 'FILE').toUpperCase();
      const fSizeStr = (typeof formatBytes === 'function' && msg.fileSize) ? formatBytes(msg.fileSize) : '';

      msgBodyHtml = `
        <div class="chat-bubble ${isSelf ? 'self' : 'other'} chat-msg-file-bubble">
          <div class="file-icon-box">
            <img src="${getFileIconSrc(fName)}" class="file-zalo-colored-icon" width="36" height="36" alt="${escapeHTML(fExt)}" onerror="this.src='../assets/zalo-icons/File_Attachment_48_Colored.svg';">
          </div>
          <div class="file-meta-box">
            <div class="file-name" title="${escapeHTML(fName)}">${escapeHTML(fName)}</div>
            <div class="file-info-sub" style="font-size: 11px; color: #94A3B8; margin-top: 2px;">
              ${escapeHTML(fExt)}${fSizeStr ? ` • ${escapeHTML(fSizeStr)}` : ''}
            </div>
            ${fUrl ? `
              <div class="file-action-row">
                ${isSaved ? `
                  <button class="btn-file-open" data-local-path="${escapeHTML(localSavedPath)}" title="Mở tệp tin">📄 Mở tệp</button>
                  <button class="btn-file-folder" data-local-path="${escapeHTML(localSavedPath)}" title="Mở thư mục chứa">📂 Mở thư mục</button>
                ` : `
                  <button class="btn-file-download-quick" data-file-url="${escapeHTML(fUrl)}" data-file-name="${escapeHTML(fName)}" title="Tải về thư mục Downloads">📥 Tải về</button>
                  <button class="btn-file-download-saveas" data-file-url="${escapeHTML(fUrl)}" data-file-name="${escapeHTML(fName)}" title="Chọn nơi lưu...">💾 Lưu thành...</button>
                `}
              </div>
            ` : '<span class="file-sub" style="font-size: 11.5px; color: #94A3B8;">Tệp tin Zalo</span>'}
          </div>
        </div>
      `;
    } else if (linkUrl) {
      msgBodyHtml = window.LinkPreview.renderCard(msg, msg.linkPreview || {});
    } else {
      msgBodyHtml = `
        <div class="chat-bubble ${isSelf ? 'self' : 'other'}">
          ${quoteHtml}
          ${escapeHTML(window.CallMessage.describeCallMessage(msg))}
        </div>
      `;
    }

    row.innerHTML = `
      ${avatarHtml}
      <div class="chat-bubble-wrap">
        ${senderHeaderHtml}
        ${msgBodyHtml}
        ${!isRevokedMsg ? reactionsHtml : ''}
        <span class="chat-msg-time">${escapeHTML(msg.time)}</span>
      </div>

      ${!isRevokedMsg ? `
      <!-- Action buttons floating on hover -->
      <div class="chat-msg-actions">
        <div class="reaction-action">
          <button type="button" class="msg-action-btn reaction-trigger" title="Bấm để thả Like, rê chuột để chọn cảm xúc" aria-label="Thả Like hoặc chọn cảm xúc"><img src="../assets/zalo-icons/Like_24_emoji.svg" alt=""></button>
          <div class="reaction-picker-menu" aria-label="Chọn cảm xúc">
            <button type="button" class="reaction-pick-emoji" data-emoji="❤️" title="Thả tim"><img src="../assets/zalo-icons/Heart_24_emoji.svg" alt="Tim"></button>
            <button type="button" class="reaction-pick-emoji" data-emoji="👍" title="Thích"><img src="../assets/zalo-icons/Like_24_emoji.svg" alt="Thích"></button>
            <button type="button" class="reaction-pick-emoji" data-emoji="😂" title="Haha"><img src="../assets/zalo-icons/Smile_24_emoji.svg" alt="Haha"></button>
            <button type="button" class="reaction-pick-emoji" data-emoji="😮" title="Wow"><img src="../assets/zalo-icons/Surprised_24_emoji.svg" alt="Wow"></button>
            <button type="button" class="reaction-pick-emoji" data-emoji="😢" title="Buồn"><img src="../assets/zalo-icons/Cry_24_emoji.svg" alt="Khóc"></button>
            <button type="button" class="reaction-pick-emoji" data-emoji="😡" title="Phẫn nộ"><img src="../assets/zalo-icons/Rage_24_emoji.svg" alt="Giận"></button>
          </div>
        </div>
        <button class="msg-action-btn btn-reply" title="Trả lời / Trích dẫn">↩️</button>
        ${isSelf ? '<button class="msg-action-btn btn-undo" title="Thu hồi tin nhắn">🚫</button>' : ''}
      </div>
      ` : ''}
    `;

    // Bắt sự kiện xem ảnh lớn trong Lightbox Modal
    const imgWrap = row.querySelector('.chat-msg-img-wrap');
    if (imgWrap) {
      imgWrap.querySelector('.chat-msg-image-surface')?.addEventListener('click', () => {
        const imgSrc = imgWrap.getAttribute('data-img-src');
        if (imgSrc && typeof openLightbox === 'function') {
          openLightbox(imgSrc);
        }
      });
    }

    // 1. Bắt sự kiện Reaction
    const sendMessageReaction = async (emoji, button) => {
      if (!window.electronAPI?.sendReaction || button.disabled) return;
      button.disabled = true;
      try {
        const result = await window.electronAPI.sendReaction(currentThread.threadId, msg.id, msg.cliMsgId, emoji, currentThread.isGroup);
        if (!result?.success) throw new Error(result?.error || 'Zalo từ chối thả cảm xúc');
        if (!msg.reactions) msg.reactions = [];
        const myUid = 'me';
        const exIdx = msg.reactions.findIndex(r => r.senderId === myUid);
        if (exIdx >= 0) msg.reactions[exIdx].icon = emoji;
        else msg.reactions.push({ icon: emoji, senderId: myUid, senderName: 'Bạn (Tôi)' });
        renderActiveChatThread(threads);
        showToast(`Đã thả ${emoji}`, 'info');
      } catch (err) {
        showToast('Lỗi thả reaction: ' + err.message, 'error');
      } finally {
        button.disabled = false;
      }
    };

    const reactionTrigger = row.querySelector('.reaction-trigger');
    if (reactionTrigger) reactionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMessageReaction('👍', reactionTrigger);
    });

    const emojiBtns = row.querySelectorAll('.reaction-pick-emoji');
    emojiBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessageReaction(btn.getAttribute('data-emoji'), btn);
      });
    });

    // 2. Bắt sự kiện Trả lời (Reply / Quote)
    const btnReply = row.querySelector('.btn-reply');
    if (btnReply) {
      btnReply.addEventListener('click', (e) => {
        e.stopPropagation();
        replyingToMessage = msg;
        if (chatQuoteBar && chatQuoteTitle && chatQuoteText) {
          chatQuoteTitle.textContent = `Trả lời: ${msg.isSelf ? 'Bạn (Tôi)' : msg.senderName}`;
          chatQuoteText.textContent = msg.content;
          chatQuoteBar.style.display = 'flex';
        }
        if (chatReplyInput) chatReplyInput.focus();
      });
    }

    // 3. Bắt sự kiện Thu hồi (Undo)
    const btnUndo = row.querySelector('.btn-undo');
    if (btnUndo) {
      btnUndo.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Bạn có chắc muốn thu hồi tin nhắn này với mọi người không?')) {
          if (window.electronAPI && window.electronAPI.undoMessage) {
            try {
              await window.electronAPI.undoMessage(currentThread.threadId, msg.id, msg.cliMsgId, currentThread.isGroup);
              msg.content = '[Tin nhắn đã được thu hồi]';
              msg.isRevoked = true;
              renderActiveChatThread(threads);
              showToast('Đã thu hồi tin nhắn thành công!', 'success');
            } catch (err) {
              showToast('Lỗi thu hồi: ' + err.message, 'error');
            }
          }
        }
      });
    }

    // 4. Bắt sự kiện tải & mở tệp tin
    const btnDlQuick = row.querySelector('.btn-file-download-quick');
    if (btnDlQuick) {
      btnDlQuick.addEventListener('click', (e) => {
        e.stopPropagation();
        const fUrl = btnDlQuick.getAttribute('data-file-url');
        const fName = btnDlQuick.getAttribute('data-file-name');
        handleDownloadFile(fUrl, fName, false, btnDlQuick);
      });
    }

    const btnDlSaveAs = row.querySelector('.btn-file-download-saveas');
    if (btnDlSaveAs) {
      btnDlSaveAs.addEventListener('click', (e) => {
        e.stopPropagation();
        const fUrl = btnDlSaveAs.getAttribute('data-file-url');
        const fName = btnDlSaveAs.getAttribute('data-file-name');
        handleDownloadFile(fUrl, fName, true, btnDlSaveAs);
      });
    }

    const btnOpenLocal = row.querySelector('.btn-file-open');
    if (btnOpenLocal) {
      btnOpenLocal.addEventListener('click', (e) => {
        e.stopPropagation();
        const lPath = btnOpenLocal.getAttribute('data-local-path');
        if (lPath && window.electronAPI && window.electronAPI.openFilePath) {
          window.electronAPI.openFilePath(lPath);
        }
      });
    }

    const btnFolderLocal = row.querySelector('.btn-file-folder');
    if (btnFolderLocal) {
      btnFolderLocal.addEventListener('click', (e) => {
        e.stopPropagation();
        const lPath = btnFolderLocal.getAttribute('data-local-path');
        if (lPath && window.electronAPI && window.electronAPI.showItemInFolder) {
          window.electronAPI.showItemInFolder(lPath);
        }
      });
    }

    // 5. Bắt sự kiện Chuột phải (Context Menu) cho tin nhắn
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (typeof showChatContextMenu === 'function') {
        showChatContextMenu(e, msg, currentThread);
      }
    });

    chatMessagesScroll.appendChild(row);
    const linkCard = row.querySelector('.chat-link-card');
    if (linkCard && !(msg.linkPreview?.title && msg.linkPreview?.image && msg.linkPreview?.description)) {
      if (!linkPreviewObserver && typeof IntersectionObserver !== 'undefined') {
        linkPreviewObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            linkPreviewObserver.unobserve(entry.target);
            loadLinkPreviewCard(entry.target, entry.target.linkMessage);
          }
        }, { root: chatMessagesScroll, rootMargin: '180px' });
      }
      linkCard.linkMessage = msg;
      if (linkPreviewObserver) linkPreviewObserver.observe(linkCard);
      else loadLinkPreviewCard(linkCard, msg);
    }
  });

  // Tự động cuộn xuống cuối cùng
  requestAnimationFrame(() => {
    if (focusIndex >= 0) scrollToAndHighlightMessage(messageFocusId);
    else chatMessagesScroll.scrollTop = chatMessagesScroll.scrollHeight;
  });
}

// Bắt sự kiện chuyển Tab lọc: Tất cả / Cá nhân / Nhóm
if (filterBtns && filterBtns.length > 0) {
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      pinnedConversationsFilter?.classList.remove('active');
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter') || 'all';
      renderDashboardFeed();
    });
  });
}

pinnedConversationsFilter?.addEventListener('click', () => {
  filterBtns?.forEach(btn => btn.classList.remove('active'));
  currentFilter = 'pinned';
  pinnedConversationsFilter.classList.add('active');
  renderDashboardFeed();
});

// Nút làm mới danh sách Nhóm Zalo từ máy chủ Zalo
if (btnFetchGroups) {
  btnFetchGroups.addEventListener('click', async () => {
    btnFetchGroups.disabled = true;
    const origHtml = btnFetchGroups.innerHTML;
    btnFetchGroups.innerHTML = '<span>Đang tải...</span>';

    try {
      showToast('Đang tải danh sách các Nhóm Zalo từ máy chủ...', 'info');
      if (window.electronAPI && window.electronAPI.fetchGroupsList) {
        const groups = await window.electronAPI.fetchGroupsList();
        if (Array.isArray(groups)) {
          allGroupsList = groups;
          renderDashboardFeed();
          showToast(`Đã cập nhật thành công ${groups.length} Nhóm Zalo!`, 'success');
        }
      }
    } catch (err) {
      showToast('Lỗi khi tải nhóm: ' + err.message, 'error');
    } finally {
      btnFetchGroups.disabled = false;
      btnFetchGroups.innerHTML = origHtml;
    }
  });
}

// Tìm kiếm cuộc trò chuyện & nội dung tin nhắn
if (conversationSearch) {
  conversationSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    const threads = getGroupedThreads();
    renderConversationList(threads);
  });
}

// Bắt sự kiện Hủy trích dẫn (Quote)
if (btnCancelQuote) {
  btnCancelQuote.addEventListener('click', () => {
    replyingToMessage = null;
    if (chatQuoteBar) chatQuoteBar.style.display = 'none';
  });
}

// Bắt sự kiện Chọn tệp đính kèm
if (btnAttachFile) {
  btnAttachFile.addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.chooseFile) {
      const filePath = await window.electronAPI.chooseFile();
      if (filePath) {
        selectedAttachment = filePath;
        const fileName = filePath.split(/[\\/]/).pop();
        if (chatAttachPreview && attachPreviewName) {
          attachPreviewName.textContent = fileName;
          chatAttachPreview.style.display = 'flex';
        }
        showToast(`Đã chọn tệp để gửi vào hội thoại hiện tại: ${fileName}`, 'info');
        if (chatReplyInput) chatReplyInput.focus();
      }
    }
  });
}

// Bắt sự kiện Hủy tệp đính kèm
if (btnCancelAttach) {
  btnCancelAttach.addEventListener('click', () => {
    selectedAttachment = null;
    if (chatAttachPreview) chatAttachPreview.style.display = 'none';
  });
}



// Gửi tin nhắn trả lời trực tiếp trong cuộc hội thoại (hỗ trợ trích dẫn và đính kèm file)
async function sendChatReply() {
  if (!chatReplyInput || !activeThreadId) return;
  const destinationId = String(activeThreadId);
  const text = chatReplyInput.value.trim();
  if (!text && !selectedAttachment) return;

  const threads = getGroupedThreads();
  const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId));
  const isGroup = currentThread ? currentThread.isGroup : false;

  const quoteToSend = replyingToMessage;
  const attachToSend = selectedAttachment ? [selectedAttachment] : null;

  chatReplyInput.value = '';
  chatReplyInput.disabled = true;
  if (btnSendChatReply) btnSendChatReply.disabled = true;

  try {
    if (window.electronAPI && window.electronAPI.sendReply) {
      const res = await window.electronAPI.sendReply(destinationId, text, isGroup, quoteToSend, attachToSend);
      if (res && res.success) {
        showToast('Đã gửi tin nhắn thành công!', 'success');
        
        // Hủy trạng thái trích dẫn và tệp đính kèm
        replyingToMessage = null;
        selectedAttachment = null;
        if (chatQuoteBar) chatQuoteBar.style.display = 'none';
        if (chatAttachPreview) chatAttachPreview.style.display = 'none';

        // Cập nhật ngay tin nhắn lên giao diện chat
        if (res.message) {
          addMessageToDashboard(res.message, false);
        } else {
          const myMsg = {
            id: 'self_' + Date.now(),
            senderName: 'Bạn (Tôi)',
            senderId: 'me',
            threadId: destinationId,
            content: text || (attachToSend ? '[Tệp đính kèm]' : ''),
            isGroup: isGroup,
            isSelf: true,
            time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
          };
          addMessageToDashboard(myMsg, false);
        }
      } else {
        if (String(activeThreadId) === destinationId) chatReplyInput.value = text;
        showToast('Không thể gửi tin: ' + (res?.error || 'Lỗi Zalo'), 'error');
      }
    }
  } catch (err) {
    if (String(activeThreadId) === destinationId) chatReplyInput.value = text;
    showToast('Lỗi gửi tin: ' + err.message, 'error');
  } finally {
    chatReplyInput.disabled = false;
    if (btnSendChatReply) btnSendChatReply.disabled = false;
    chatReplyInput.focus();
  }
}

if (btnSendChatReply) {
  btnSendChatReply.addEventListener('click', sendChatReply);
}
if (chatReplyInput) {
  chatReplyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatReply();
    }
  });
}

if (window.electronAPI && window.electronAPI.onNewMessage) {
  window.electronAPI.onNewMessage((message, isOld = false) => {
    addMessageToDashboard(message, isOld);
  });
}

// Thử tin nhắn mẫu
function triggerTestMessage() {
  if (window.electronAPI && window.electronAPI.sendTestMessage) {
    window.electronAPI.sendTestMessage();
  }
}

btnQuickTest.addEventListener('click', triggerTestMessage);
btnTestInTab.addEventListener('click', triggerTestMessage);

// Xóa nhật ký
btnClearHistory.addEventListener('click', async () => {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử tin nhắn đã lưu?')) {
    messagesHistory = [];
    if (window.electronAPI && window.electronAPI.clearHistoryMessages) {
      await window.electronAPI.clearHistoryMessages();
    }
    renderDashboardFeed();
    showToast('Đã xóa sạch toàn bộ lịch sử tin nhắn!', 'info');
  }
});

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// =========================================
// 4. CÀI ĐẶT BONG BÓNG CHAT
// =========================================
if (btnResetBubblePos) {
  btnResetBubblePos.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.bubbleResetPosition) {
      window.electronAPI.bubbleResetPosition();
      alert('Đã đưa bong bóng chat về góc dưới bên phải màn hình!');
    }
  });
}

if (toggleBubbleVisible) {
  toggleBubbleVisible.addEventListener('change', (e) => {
    if (window.electronAPI && window.electronAPI.bubbleToggleVisibility) {
      window.electronAPI.bubbleToggleVisibility(e.target.checked);
    }
  });
}

// =========================================
// QUẢN LÝ MODAL CHỜ ĐỒNG BỘ ĐIỆN THOẠI (SYNC MODAL)
// =========================================
const syncModalOverlay = document.getElementById('sync-modal-overlay');
const syncModalTitle = document.getElementById('sync-modal-title');
const syncModalDesc = document.getElementById('sync-modal-desc');
const syncAnimIcon = document.getElementById('sync-anim-icon');
const syncStep1 = document.getElementById('sync-step-1');
const syncStep2 = document.getElementById('sync-step-2');
const syncStep3 = document.getElementById('sync-step-3');
const syncProgressFill = document.getElementById('sync-progress-fill');
const syncTimerLabel = document.getElementById('sync-timer-label');
const btnCancelSyncModal = document.getElementById('btn-cancel-sync-modal');

let syncCountdownInterval = null;
let syncRemainingSeconds = 60;
let syncElapsedTimer = null;
let syncElapsedSeconds = 0;

function startSyncElapsedTime(initialSec = 0) {
  if (syncElapsedTimer) clearInterval(syncElapsedTimer);
  syncElapsedSeconds = initialSec || 0;
  syncElapsedTimer = setInterval(() => {
    syncElapsedSeconds++;
    const mins = String(Math.floor(syncElapsedSeconds / 60)).padStart(2, '0');
    const secs = String(syncElapsedSeconds % 60).padStart(2, '0');
    if (syncTimerLabel) {
      syncTimerLabel.textContent = `⏱ Thời gian đồng bộ: ${mins}:${secs} • Dữ liệu lớn có thể mất vài phút`;
    }
  }, 1000);
}

function stopSyncElapsedTime() {
  if (syncElapsedTimer) {
    clearInterval(syncElapsedTimer);
    syncElapsedTimer = null;
  }
}

function openSyncModal() {
  if (!syncModalOverlay) return;
  syncModalOverlay.classList.add('active');
  stopSyncElapsedTime();
  if (btnCancelSyncModal) {
    btnCancelSyncModal.textContent = 'Đóng';
    btnCancelSyncModal.classList.remove('btn-done');
  }
  updateSyncModalStep(1, 10, '📱', 'Đang gửi yêu cầu tới điện thoại...', 'Ứng dụng đang chờ máy chủ Zalo chấp nhận yêu cầu đồng bộ.');
  if (syncCountdownInterval) clearInterval(syncCountdownInterval);
  syncCountdownInterval = null;
  startSyncElapsedTime();
}

function closeSyncModal() {
  if (!syncModalOverlay) return;
  syncModalOverlay.classList.remove('active');
  if (syncCountdownInterval) {
    clearInterval(syncCountdownInterval);
    syncCountdownInterval = null;
  }
  stopSyncElapsedTime();
}

function updateSyncModalStep(step, progress, icon, title, desc) {
  if (syncModalTitle) syncModalTitle.textContent = title;
  if (syncModalDesc) syncModalDesc.innerHTML = desc;
  if (syncAnimIcon) syncAnimIcon.textContent = icon;
  if (syncProgressFill) syncProgressFill.style.width = `${progress}%`;

  if (syncStep1 && syncStep2 && syncStep3) {
    syncStep1.className = 'sync-step-row ' + (step > 1 ? 'done' : (step === 1 ? 'active' : ''));
    syncStep2.className = 'sync-step-row ' + (step > 2 ? 'done' : (step === 2 ? 'active' : ''));
    syncStep3.className = 'sync-step-row ' + (step === 3 ? (progress >= 100 ? 'done' : 'active') : '');
  }
}

if (btnCancelSyncModal) {
  btnCancelSyncModal.addEventListener('click', closeSyncModal);
}

// Lắng nghe sự kiện đồng bộ chi tiết từ main process
if (window.electronAPI && window.electronAPI.onSyncStatus) {
  window.electronAPI.onSyncStatus(async (status) => {
    console.log('Sync status event:', status);

    if (status.phase === 'startup_scanning') {
      const button = document.getElementById('btn-quick-sync-cloud');
      if (button) button.disabled = true;
      const icon = document.getElementById('quick-sync-icon');
      const label = document.getElementById('quick-sync-text');
      const autoCheck = document.getElementById('stat-auto-check-time');
      if (icon) icon.textContent = '⏳';
      if (label) label.textContent = 'Đang đồng bộ...';
      if (autoCheck) autoCheck.textContent = 'Đang đồng bộ nhanh khi khởi động';
    } else if (['startup_completed', 'startup_failed', 'startup_deferred'].includes(status.phase)) {
      const button = document.getElementById('btn-quick-sync-cloud');
      if (button) button.disabled = false;
      const icon = document.getElementById('quick-sync-icon');
      const label = document.getElementById('quick-sync-text');
      if (icon) icon.textContent = '⚡';
      if (label) label.textContent = 'Đồng bộ nhanh';
      const autoCheck = document.getElementById('stat-auto-check-time');
      if (autoCheck) autoCheck.textContent = status.phase === 'startup_completed'
        ? `${new Date().toLocaleTimeString('vi-VN')} • +${Number(status.added || 0)} tin`
        : status.message || 'Đang chờ kết nối';
      if (status.phase === 'startup_completed' && status.added > 0) {
        await refreshConversationHeads();
        showToast(status.message, 'success');
      } else if (status.phase === 'startup_failed') {
        showToast(status.message || 'Chưa thể đồng bộ nhanh khi khởi động', 'warning');
      }
    } else if (status.phase === 'identities_updated') {
      await loadGroupsData(false);
      messagesHistory = [];
      threadHistoryLoaded.clear();
      threadHistoryExhausted.clear();
      await refreshConversationHeads();
    } else if (status.phase === 'requesting_phone') {
      updateSyncModalStep(1, 10, '📱', status.title || 'Đang gửi yêu cầu tới điện thoại', status.message || 'Đang chờ máy chủ Zalo.');
    } else if (status.phase === 'scanning') {
      if (!syncModalOverlay?.classList.contains('active')) openSyncModal();
      updateSyncModalStep(2, status.progress || 40, '📥', status.title || 'Đang tải lịch sử tin nhắn', status.message || 'Đang nhận tin nhắn từ Zalo.');
    } else if (status.phase === 'failed') {
      stopSyncElapsedTime();
      updateSyncModalStep(1, 0, '⚠️', status.title || 'Không thể đồng bộ', status.message || 'Kết nối Zalo chưa sẵn sàng.');
      showToast(status.message || 'Không thể đồng bộ tin nhắn', 'error');
    } else if (status.phase === 'partial') {
      stopSyncElapsedTime();
      threadHistoryLoaded.clear();
      threadHistoryExhausted.clear();
      if (syncTimerLabel) syncTimerLabel.textContent = '⚠️ Điện thoại đã sao lưu xong; ứng dụng chưa nhập được bản sao lưu.';
      updateSyncModalStep(3, status.progress ?? 0, '⚠️', status.title || 'Đồng bộ điện thoại chưa hoàn tất', status.message || 'Bản sao lưu điện thoại chưa được nhập.');
      showToast(status.message || 'Đồng bộ điện thoại chưa hoàn tất.', 'warning');
      await refreshConversationHeads();
    } else if (status.phase === 'waiting_phone') {
      if (!syncModalOverlay?.classList.contains('active')) openSyncModal();
      updateSyncModalStep(1, 20, '📱', status.title || 'Máy chủ đã nhận yêu cầu', status.message || 'Đang chờ điện thoại phản hồi.');
    } else if (status.phase === 'phone_waiting_confirm') {
      updateSyncModalStep(1, 20, '📱', status.title || 'Điện thoại đã nhận yêu cầu!', status.message || 'Vui lòng mở ứng dụng Zalo trên điện thoại và bấm chọn "ĐỒNG BỘ NGAY".');
      showToast('📱 Điện thoại Zalo đã nhận yêu cầu! Hãy bấm "ĐỒNG BỘ NGAY".', 'info');

    } else if (status.phase === 'phone_rejected' || status.phase === 'phone_cancelled' || status.phase === 'phone_busy') {
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      stopSyncElapsedTime();
      if (syncTimerLabel) {
        syncTimerLabel.textContent = `❌ ${status.title || 'Đồng bộ không thành công'}`;
      }
      updateSyncModalStep(1, 0, '⚠️', status.title || 'Đồng bộ bị dừng', status.message || 'Yêu cầu đồng bộ không hoàn tất.');
      showToast(status.message || 'Đồng bộ không thành công!', 'warning');

    } else if (status.phase === 'phone_preparing' || status.phase === 'phone_confirmed') {
      // Dừng bộ đếm ngược xác nhận - chuyển sang đếm thời gian thực
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      startSyncElapsedTime();
      updateSyncModalStep(2, status.progress || 35, '⏳', status.title || 'Điện thoại đang chuẩn bị dữ liệu...', status.message || 'Vui lòng giữ ứng dụng Zalo trên điện thoại sáng màn hình.');
      showToast('📱 Điện thoại đã xác nhận! Đang chuẩn bị dữ liệu...', 'info');

    } else if (status.phase === 'phone_transferring') {
      // Đang truyền các gói dữ liệu từ điện thoại sang máy tính
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      if (!syncElapsedTimer) {
        startSyncElapsedTime(status.elapsedSec || 0);
      }
      updateSyncModalStep(2, status.progress || 50, '📲', status.title || 'Điện thoại đang truyền dữ liệu...', status.message || 'Đang nhận dữ liệu từ điện thoại. Dữ liệu lớn có thể mất vài phút!');

    } else if (['downloading_backup', 'decrypting_backup', 'importing_backup'].includes(status.phase)) {
      if (!syncModalOverlay?.classList.contains('active')) openSyncModal();
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      const icons = { downloading_backup: '📥', decrypting_backup: '🔓', importing_backup: '💾' };
      updateSyncModalStep(3, status.progress || 85, icons[status.phase],
        status.title || 'Đang nhập bản sao lưu điện thoại',
        status.message || 'Đang xử lý toàn bộ tin nhắn đã sao lưu.');

    } else if (status.phase === 'finalizing') {
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      stopSyncElapsedTime();
      if (syncTimerLabel) {
        syncTimerLabel.textContent = '⚡ Điện thoại đã hoàn tất 100%! Đang nạp toàn bộ tin nhắn...';
      }
      updateSyncModalStep(3, 95, '📦', status.title || 'Điện thoại đã chuẩn bị xong 100%!', status.message || 'Đang cập nhật toàn bộ tin nhắn vào ứng dụng...');

    } else if (status.phase === 'completed') {
      if (syncCountdownInterval) {
        clearInterval(syncCountdownInterval);
        syncCountdownInterval = null;
      }
      stopSyncElapsedTime();
      threadHistoryLoaded.clear();
      threadHistoryExhausted.clear();
      if (syncTimerLabel) {
        syncTimerLabel.textContent = '✅ ' + (status.title || 'Đồng bộ hoàn tất');
      }
      if (btnCancelSyncModal) {
        btnCancelSyncModal.textContent = 'Đóng / Hoàn tất';
        btnCancelSyncModal.classList.add('btn-done');
      }

      updateSyncModalStep(3, 100, '✅', status.title || 'Đồng bộ hoàn tất!', status.message || 'Tin nhắn đã lưu trên máy sẵn sàng.');
      showToast(status.message || 'Đồng bộ tin nhắn thành công!', 'success');

      await refreshConversationHeads();

      // Giữ modal trong 4.5 giây để người dùng kịp đọc kết quả hoặc bấm Hoàn tất
      setTimeout(() => {
        closeSyncModal();
      }, 4500);
    }
  });
}

// ============================================================
// LOGIC KIỂM TRA TRẠNG THÁI ĐỒNG BỘ & ĐỒNG BỘ NHANH (QUICK SYNC)
// ============================================================
async function openSyncStatusModal() {
  const modal = document.getElementById('sync-status-modal-overlay');
  if (!modal) return;
  modal.style.display = 'flex';

  if (window.electronAPI && window.electronAPI.getSyncStatus) {
    try {
      const status = await window.electronAPI.getSyncStatus();
      if (status) {
        const statMsg = document.getElementById('stat-total-messages');
        const statSize = document.getElementById('stat-file-size');
        const statConv = document.getElementById('stat-total-conversations');
        const statContacts = document.getElementById('stat-total-contacts');
        const statWs = document.getElementById('stat-ws-status');
        const statLastSync = document.getElementById('stat-last-sync-time');
        const statAutoCheck = document.getElementById('stat-auto-check-time');

        if (statMsg) statMsg.textContent = Number(status.totalMessages || messagesHistory.length).toLocaleString('vi-VN');
        if (statSize) statSize.textContent = `${Math.round((status.fileSize || 0) / 1024)} KB`;
        if (statConv) statConv.textContent = `${status.totalConversations || 0} cuộc trò chuyện`;
        if (statContacts) statContacts.textContent = `${status.totalGroups || 0} nhóm • ${status.totalFriends || 0} bạn bè`;
        if (statWs) {
          statWs.textContent = status.isListenerConnected ? '🟢 Đang kết nối ổn định (Real-time)' : '🟡 Đang kết nối lại';
          statWs.style.color = status.isListenerConnected ? '#34D399' : '#FBBF24';
        }
        if (statLastSync) {
          const d = status.lastSyncTime ? new Date(status.lastSyncTime) : null;
          statLastSync.textContent = d
            ? d.toLocaleTimeString('vi-VN') + ' ' + d.toLocaleDateString('vi-VN')
            : 'Chưa đồng bộ trong phiên này';
        }
        if (statAutoCheck) {
          statAutoCheck.textContent = status.lastRecentCheckTime
            ? `${new Date(status.lastRecentCheckTime).toLocaleTimeString('vi-VN')} • +${Number(status.lastRecentAdded || 0)} tin`
            : 'Đang chờ kết nối';
        }
      }
    } catch (e) {
      console.warn('Lỗi lấy getSyncStatus:', e);
    }
  }
}

function closeSyncStatusModal() {
  const modal = document.getElementById('sync-status-modal-overlay');
  if (modal) modal.style.display = 'none';
}

async function handleQuickSync() {
  const btnQuickSync = document.getElementById('btn-quick-sync-cloud');
  const quickSyncIcon = document.getElementById('quick-sync-icon');
  const quickSyncText = document.getElementById('quick-sync-text');
  const btnModalQuickSync = document.getElementById('btn-modal-quick-sync');

  if (quickSyncIcon) quickSyncIcon.textContent = '⏳';
  if (quickSyncText) quickSyncText.textContent = 'Đang đồng bộ...';
  if (btnQuickSync) btnQuickSync.disabled = true;
  if (btnModalQuickSync) {
    btnModalQuickSync.disabled = true;
    btnModalQuickSync.textContent = '⏳ Đang quét tin nhắn...';
  }

  showToast('Đang tải lịch sử gần đây qua kết nối Zalo...', 'info');

  try {
    if (window.electronAPI && window.electronAPI.quickSyncMessages) {
      const res = await window.electronAPI.quickSyncMessages();
      if (res && res.success) {
        showToast(`Đã lưu thêm ${res.added || 0} tin nhắn mới.`, 'success');
        await refreshConversationHeads();
        openSyncStatusModal();
      } else {
        showToast(res?.error || 'Không thể đồng bộ nhanh', 'warning');
      }
    }
  } catch (err) {
    showToast('Lỗi đồng bộ nhanh: ' + err.message, 'error');
  } finally {
    if (quickSyncIcon) quickSyncIcon.textContent = '⚡';
    if (quickSyncText) quickSyncText.textContent = 'Đồng bộ nhanh';
    if (btnQuickSync) btnQuickSync.disabled = false;
    if (btnModalQuickSync) {
      btnModalQuickSync.disabled = false;
      btnModalQuickSync.innerHTML = '<span>⚡ Đồng bộ nhanh tin nhắn gần đây</span>';
    }
  }
}

const btnSyncHistoryStatus = document.getElementById('btn-sync-history-status');
if (btnSyncHistoryStatus) {
  btnSyncHistoryStatus.addEventListener('click', openSyncStatusModal);
}
const btnCloseSyncStatusModal = document.getElementById('btn-close-sync-status-modal');
if (btnCloseSyncStatusModal) {
  btnCloseSyncStatusModal.addEventListener('click', closeSyncStatusModal);
}
const syncStatusModalOverlay = document.getElementById('sync-status-modal-overlay');
if (syncStatusModalOverlay) {
  syncStatusModalOverlay.addEventListener('click', (e) => {
    if (e.target === syncStatusModalOverlay) closeSyncStatusModal();
  });
}
const btnQuickSyncCloud = document.getElementById('btn-quick-sync-cloud');
if (btnQuickSyncCloud) {
  btnQuickSyncCloud.addEventListener('click', handleQuickSync);
}
const btnModalQuickSync = document.getElementById('btn-modal-quick-sync');
if (btnModalQuickSync) {
  btnModalQuickSync.addEventListener('click', handleQuickSync);
}
const btnModalOpenFolder = document.getElementById('btn-modal-open-folder');
if (btnModalOpenFolder) {
  btnModalOpenFolder.addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.openDataFolder) {
      window.electronAPI.openDataFolder();
    }
  });
}

// ============================================================
// LOGIC XỬ LÝ HÌNH ẢNH (LIGHTBOX), EMOJI & STICKER ZALO
// ============================================================

// 1. Lightbox xem ảnh lớn
function openLightbox(src) {
  if (!imageLightboxModal || !lightboxImg) return;
  lightboxImg.src = src;
  imageLightboxModal.style.display = 'flex';
}

function closeLightbox() {
  if (imageLightboxModal) {
    imageLightboxModal.style.display = 'none';
    if (lightboxImg) lightboxImg.src = '';
  }
}

if (btnLightboxClose) {
  btnLightboxClose.addEventListener('click', closeLightbox);
}
if (lightboxOverlay) {
  lightboxOverlay.addEventListener('click', closeLightbox);
}
if (btnLightboxExternal) {
  btnLightboxExternal.addEventListener('click', () => {
    if (lightboxImg && lightboxImg.src) {
      window.open(lightboxImg.src, '_blank');
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && imageLightboxModal && imageLightboxModal.style.display === 'flex') {
    closeLightbox();
  }
});

// 2. Danh sách Emoji thông dụng
const popularEmojis = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
  '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐',
  '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧',
  '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲',
  '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫',
  '🥱', '😤', '😡', '😠', '🤬', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝',
  '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖'
];

// 3. Hệ thống Danh mục Sticker Zalo phong phú & Tìm kiếm trực tuyến
const stickerCategories = {
  hot: [
    { id: 16715, cateId: 10047, name: 'Vui vẻ' },
    { id: 16716, cateId: 10047, name: 'Thả tim' },
    { id: 16717, cateId: 10047, name: 'Hôn' },
    { id: 16718, cateId: 10047, name: 'Cười toe' },
    { id: 16723, cateId: 10047, name: 'OK' },
    { id: 21237, cateId: 10291, name: 'Tuyệt vời' },
    { id: 21239, cateId: 10291, name: 'Cảm ơn' },
    { id: 46182, cateId: 11954, name: 'Haha' },
    { id: 50629, cateId: 12210, name: 'Chào bạn' },
    { id: 23042, cateId: 10321, name: 'Vui quá' },
    { id: 25581, cateId: 10452, name: 'Phấn khởi' },
    { id: 24108, cateId: 10389, name: 'Nụ cười' },
    { id: 43519, cateId: 11782, name: 'Đồng ý' },
    { id: 34842, cateId: 10923, name: 'Chuẩn' },
    { id: 27180, cateId: 10567, name: 'Thanks' },
    { id: 20695, cateId: 10123, name: 'Heo Cười' },
    { id: 20696, cateId: 10123, name: 'Heo Bắn tim' }
  ],
  ami: [
    { id: 16715, cateId: 10047, name: 'Ami Vui vẻ' },
    { id: 16716, cateId: 10047, name: 'Ami Thả tim' },
    { id: 16717, cateId: 10047, name: 'Ami Hôn' },
    { id: 16718, cateId: 10047, name: 'Ami Cười toe' },
    { id: 16719, cateId: 10047, name: 'Ami Khóc' },
    { id: 16720, cateId: 10047, name: 'Ami Dỗi hờn' },
    { id: 16721, cateId: 10047, name: 'Ami Vẫy tay' },
    { id: 16722, cateId: 10047, name: 'Ami Chúc ngủ ngon' },
    { id: 16723, cateId: 10047, name: 'Ami OK' },
    { id: 16724, cateId: 10047, name: 'Ami Ngại ngùng' },
    { id: 16725, cateId: 10047, name: 'Ami Hát hò' },
    { id: 16726, cateId: 10047, name: 'Ami Điệu đà' }
  ],
  haha: [
    { id: 46182, cateId: 11954, name: 'Haha lớn' },
    { id: 1111, cateId: 10001, name: 'Cười' },
    { id: 45356, cateId: 11892, name: 'Bật cười' },
    { id: 47154, cateId: 12012, name: 'Ôm bụng cười' },
    { id: 17841, cateId: 10111, name: 'Hihi' },
    { id: 23042, cateId: 10321, name: 'Vui vẻ' },
    { id: 25581, cateId: 10452, name: 'Khoái chí' },
    { id: 21452, cateId: 10298, name: 'Đắc ý' },
    { id: 24108, cateId: 10389, name: 'Hớn hở' },
    { id: 26231, cateId: 10512, name: 'Cười mỉm' }
  ],
  ok: [
    { id: 21237, cateId: 10291, name: 'OK Number 1' },
    { id: 43519, cateId: 11782, name: 'Đồng ý luôn' },
    { id: 16715, cateId: 10047, name: 'Duyệt' },
    { id: 34842, cateId: 10923, name: 'Tuyệt đối' },
    { id: 21644, cateId: 10305, name: 'Nhất trí' },
    { id: 21239, cateId: 10291, name: 'Cảm ơn nhiều' },
    { id: 27180, cateId: 10567, name: 'Thanks' },
    { id: 33879, cateId: 10872, name: 'Biết ơn' },
    { id: 50625, cateId: 12210, name: 'Cúi đầu cảm ơn' },
    { id: 23434, cateId: 10344, name: 'Hoan hô' }
  ],
  love: [
    { id: 50616, cateId: 12210, name: 'Bắn tim' },
    { id: 50344, cateId: 12188, name: 'Trái tim' },
    { id: 99994, cateId: 13500, name: 'Yêu thương' },
    { id: 98973, cateId: 13452, name: 'Gửi ngàn nụ hôn' },
    { id: 49504, cateId: 12140, name: 'Thương thương' },
    { id: 16716, cateId: 10047, name: 'Ami Thả tim' },
    { id: 20696, cateId: 10123, name: 'Heo Bắn tim' }
  ],
  heo: [
    { id: 20695, cateId: 10123, name: 'Heo Cười' },
    { id: 20696, cateId: 10123, name: 'Heo Bắn tim' },
    { id: 20697, cateId: 10123, name: 'Heo Vỗ tay' },
    { id: 20698, cateId: 10123, name: 'Heo Nháy mắt' },
    { id: 20699, cateId: 10123, name: 'Heo Suy tư' },
    { id: 20700, cateId: 10123, name: 'Heo Ngại' },
    { id: 20701, cateId: 10123, name: 'Heo Khóc' },
    { id: 20702, cateId: 10123, name: 'Heo Ăn uống' }
  ],
  aka: [
    { id: 10050, cateId: 10012, name: 'Quỳnh Aka Chào' },
    { id: 10051, cateId: 10012, name: 'Quỳnh Aka Cười' },
    { id: 10052, cateId: 10012, name: 'Quỳnh Aka Dỗi' },
    { id: 10053, cateId: 10012, name: 'Quỳnh Aka Like' },
    { id: 10054, cateId: 10012, name: 'Quỳnh Aka Khóc' },
    { id: 10055, cateId: 10012, name: 'Quỳnh Aka Ăn vạ' },
    { id: 10056, cateId: 10012, name: 'Quỳnh Aka Giận dữ' },
    { id: 10057, cateId: 10012, name: 'Quỳnh Aka Vỗ mông' }
  ]
};

function renderStickerGrid(stickersToRender) {
  if (!stickerGrid) return;
  stickerGrid.innerHTML = '';

  if (!stickersToRender || stickersToRender.length === 0) {
    stickerGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748B; padding: 20px;">Không tìm thấy sticker phù hợp</div>';
    return;
  }

  stickersToRender.forEach(stk => {
    const btn = document.createElement('button');
    btn.className = 'sticker-grid-btn';
    const imgUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stk.id}&size=130`;
    btn.innerHTML = `
      <img src="${imgUrl}" alt="${stk.name || 'Sticker'}" loading="lazy" onerror="this.onerror=null; this.src='https://api.zaloapp.com/api/emoticon/sticker/webpc?eid=${stk.id}&size=130';">
      <span class="sticker-label">${stk.name || ''}</span>
    `;
    btn.title = 'Gửi sticker ' + (stk.name || '');

    btn.addEventListener('click', async () => {
      if (!activeThreadId) {
        showToast('Vui lòng chọn một cuộc trò chuyện để gửi sticker', 'info');
        return;
      }
      const threads = getGroupedThreads();
      const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId));
      const isGroup = currentThread ? currentThread.isGroup : false;

      try {
        showToast('Đang gửi sticker Zalo...', 'info');
        if (window.electronAPI && window.electronAPI.sendSticker) {
          const result = await window.electronAPI.sendSticker(activeThreadId, stk, isGroup);
          if (result?.success === false) throw new Error(result.error || 'Gửi sticker thất bại');
          showToast('Đã gửi sticker Zalo thành công! 🎉', 'success');
          if (emojiPickerContainer) emojiPickerContainer.style.display = 'none';
        }
      } catch (err) {
        showToast('Lỗi gửi sticker: ' + err.message, 'error');
      }
    });

    stickerGrid.appendChild(btn);
  });
}

function initEmojiAndStickers() {
  const btnToggleSticker = document.getElementById('btn-toggle-sticker');
  const stickerSearchInput = document.getElementById('sticker-search-input');
  const stickerCatPills = document.querySelectorAll('.stk-cat-pill');
  const stickerToolbarWrap = document.getElementById('sticker-toolbar-wrap');
  const tabBtnStickers = document.getElementById('tab-btn-stickers');
  const tabBtnEmojis = document.getElementById('tab-btn-emojis');

  // 1. Mặc định render danh mục Sticker "hot"
  renderStickerGrid(stickerCategories.hot);

  // 2. Render Emoji Grid
  if (emojiGrid) {
    emojiGrid.innerHTML = '';
    popularEmojis.forEach(em => {
      const btn = document.createElement('button');
      btn.className = 'emoji-grid-btn';
      btn.textContent = em;
      btn.title = 'Chèn ' + em;
      btn.addEventListener('click', () => {
        if (chatReplyInput) {
          chatReplyInput.value += em;
          chatReplyInput.focus();
        }
      });
      emojiGrid.appendChild(btn);
    });
  }

  // 3. Chuyển đổi danh mục Sticker (Hot, Ami, Haha, OK...)
  if (stickerCatPills && stickerCatPills.length > 0) {
    stickerCatPills.forEach(pill => {
      pill.addEventListener('click', () => {
        stickerCatPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const catKey = pill.getAttribute('data-cat');
        if (stickerCategories[catKey]) {
          renderStickerGrid(stickerCategories[catKey]);
        }
      });
    });
  }

  // 4. Tìm kiếm Sticker Zalo thông minh
  let searchStickerTimer = null;
  if (stickerSearchInput) {
    stickerSearchInput.addEventListener('input', (e) => {
      const kw = e.target.value.trim().toLowerCase();
      if (searchStickerTimer) clearTimeout(searchStickerTimer);

      if (!kw) {
        renderStickerGrid(stickerCategories.hot);
        return;
      }

      searchStickerTimer = setTimeout(async () => {
        // Tìm nhanh trong các danh mục cục bộ trước
        const localMatches = [];
        Object.values(stickerCategories).forEach(catList => {
          catList.forEach(s => {
            if ((s.name || '').toLowerCase().includes(kw)) {
              if (!localMatches.some(m => m.id === s.id)) localMatches.push(s);
            }
          });
        });

        if (localMatches.length > 0) {
          renderStickerGrid(localMatches);
        }

        // Tìm kiếm trực tuyến từ Zalo API
        if (window.electronAPI && window.electronAPI.getStickers) {
          try {
            const ids = await window.electronAPI.getStickers(kw);
            if (Array.isArray(ids) && ids.length > 0) {
              const liveStickers = ids.slice(0, 24).map(id => ({
                id: Number(id),
                cateId: 10047,
                type: 7,
                name: kw
              }));
              renderStickerGrid(liveStickers);
            } else if (localMatches.length === 0) {
              renderStickerGrid([]);
            }
          } catch (err) {
            console.warn('Lỗi tìm sticker online:', err);
          }
        }
      }, 350);
    });
  }

  // 5. Chuyển Tab giữa Emoji và Sticker
  const tabBtns = document.querySelectorAll('.emoji-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.getAttribute('data-tab');
      const emojiPanel = document.getElementById('emoji-tab-content');
      const stickerPanel = document.getElementById('sticker-tab-content');
      if (tabName === 'emojis') {
        if (emojiPanel) emojiPanel.classList.add('active');
        if (stickerPanel) stickerPanel.classList.remove('active');
        if (stickerToolbarWrap) stickerToolbarWrap.style.display = 'none';
      } else {
        if (emojiPanel) emojiPanel.classList.remove('active');
        if (stickerPanel) stickerPanel.classList.add('active');
        if (stickerToolbarWrap) stickerToolbarWrap.style.display = 'flex';
      }
    });
  });

  // 6. Nút Mở Sticker riêng (🐱)
  if (btnToggleSticker && emojiPickerContainer) {
    btnToggleSticker.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = emojiPickerContainer.style.display === 'flex';
      const isCurrentStickers = tabBtnStickers && tabBtnStickers.classList.contains('active');

      if (isVisible && isCurrentStickers) {
        emojiPickerContainer.style.display = 'none';
      } else {
        emojiPickerContainer.style.display = 'flex';
        if (tabBtnStickers) tabBtnStickers.click();
        if (stickerSearchInput) stickerSearchInput.focus();
      }
    });
  }

  // 7. Nút Mở Emoji riêng (😊)
  if (btnToggleEmoji && emojiPickerContainer) {
    btnToggleEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = emojiPickerContainer.style.display === 'flex';
      const isCurrentEmojis = tabBtnEmojis && tabBtnEmojis.classList.contains('active');

      if (isVisible && isCurrentEmojis) {
        emojiPickerContainer.style.display = 'none';
      } else {
        emojiPickerContainer.style.display = 'flex';
        if (tabBtnEmojis) tabBtnEmojis.click();
      }
    });
  }

  // Đóng Popup khi click nút đóng hoặc click ra ngoài
  if (btnCloseEmojiPicker && emojiPickerContainer) {
    btnCloseEmojiPicker.addEventListener('click', () => {
      emojiPickerContainer.style.display = 'none';
    });
  }
  document.addEventListener('click', (e) => {
    if (emojiPickerContainer && emojiPickerContainer.style.display === 'flex') {
      if (!emojiPickerContainer.contains(e.target) && 
          !(btnToggleEmoji && btnToggleEmoji.contains(e.target)) &&
          !(btnToggleSticker && btnToggleSticker.contains(e.target))) {
        emojiPickerContainer.style.display = 'none';
      }
    }
  });

  // Nút gửi ảnh nhanh (🖼️)
  if (btnQuickPhoto) {
    btnQuickPhoto.addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.chooseFile) {
        const filePath = await window.electronAPI.chooseFile();
        if (filePath) {
          selectedAttachment = filePath;
          const fileName = filePath.split(/[\\/]/).pop();
          if (chatAttachPreview && attachPreviewName) {
            attachPreviewName.textContent = '🖼️ ' + fileName;
            chatAttachPreview.style.display = 'flex';
          }
          showToast(`Đã chọn ảnh để gửi vào hội thoại hiện tại: ${fileName}`, 'info');
          if (chatReplyInput) chatReplyInput.focus();
        }
      }
    });
  }
}

// Khởi chạy hệ thống Emoji & Sticker
initEmojiAndStickers();

// Sự kiện Bật / Tắt thông báo cho cuộc trò chuyện đang mở
if (btnToggleMuteChat) {
  btnToggleMuteChat.addEventListener('click', async () => {
    if (!activeThreadId) {
      showToast('Vui lòng chọn một cuộc trò chuyện để tắt/bật thông báo', 'info');
      return;
    }
    const threads = getGroupedThreads();
    const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId));
    if (!currentThread) return;

    const strId = String(activeThreadId);
    const nextMuted = !mutedThreadIds.has(strId);
    try {
      const result = await window.electronAPI.setThreadMute(strId, nextMuted, currentThread.isGroup, -1);
      if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
      if (nextMuted) mutedThreadIds.add(strId);
      else mutedThreadIds.delete(strId);
      showToast(nextMuted ? `Đã tắt thông báo "${currentThread.senderName}"` : `Đã bật thông báo "${currentThread.senderName}"`, 'success');
      renderDashboardFeed();
    } catch (err) {
      showToast(`Không thể đổi thông báo: ${err.message}`, 'error');
    }
  });
}

// ============================================================
// TÍNH NĂNG BẢNG THÔNG TIN HỘI THOẠI (ẢNH, VIDEO, FILE, LINK)
// ============================================================
let currentInfoTab = 'media'; // 'media' | 'files' | 'links' | 'members' | 'board'
let isInfoPanelOpen = false;
const conversationToolsCache = new Map();

async function renderConversationTools(container, thread) {
  const threadId = String(thread.threadId);
  const cached = conversationToolsCache.get(threadId);
  let tools = cached && Date.now() - cached.time < 30000 ? cached.data : null;
  try {
    if (!tools) {
      tools = await window.electronAPI.getConversationTools(threadId, thread.isGroup);
      conversationToolsCache.set(threadId, { time: Date.now(), data: tools });
    }
    if (!container.isConnected || String(activeThreadId) !== threadId) return;
    container.replaceChildren();
    const entries = [
      ...(tools.boards || []).map(item => ({
        title: item.data?.question || item.data?.params?.title || 'Mục bảng nhóm',
        detail: item.boardType === 3 ? `Bình chọn • ${item.data?.num_vote || 0} lượt` : item.boardType === 1 ? 'Ghi chú nhóm' : 'Tin nhắn đã ghim'
      })),
      ...(tools.reminders || []).map(item => ({
        title: item.params?.title || 'Nhắc hẹn',
        detail: item.startTime ? `Nhắc hẹn • ${new Date(Number(item.startTime) < 1e12 ? Number(item.startTime) * 1000 : Number(item.startTime)).toLocaleString('vi-VN')}` : 'Nhắc hẹn'
      }))
    ];
    if (!entries.length) {
      container.textContent = 'Chưa có bình chọn, ghi chú hoặc nhắc hẹn trong hội thoại này.';
      return;
    }
    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'conversation-tool-item';
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const detail = document.createElement('small');
      detail.textContent = entry.detail;
      card.append(title, detail);
      container.appendChild(card);
    }
  } catch (error) {
    if (container.isConnected) container.textContent = `Không thể tải bảng hội thoại: ${error.message}`;
  }
}

function toggleConversationInfoPanel(forceState = null) {
  if (!chatInfoPanel) return;
  const chatContainer = document.querySelector('.zalo-chat-container');
  isInfoPanelOpen = forceState !== null ? forceState : !isInfoPanelOpen;

  if (isInfoPanelOpen) {
    chatInfoPanel.style.display = 'flex';
    if (chatContainer) chatContainer.classList.add('has-info-open');
    if (btnToggleInfoPanel) btnToggleInfoPanel.classList.add('active');
    renderConversationInfoPanel();
  } else {
    chatInfoPanel.style.display = 'none';
    if (chatContainer) chatContainer.classList.remove('has-info-open');
    if (btnToggleInfoPanel) btnToggleInfoPanel.classList.remove('active');
  }
}

function renderConversationInfoPanel() {
  if (!chatInfoBody || !isInfoPanelOpen) return;
  const threads = getGroupedThreads();
  const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId)) || threads[0];
  if (!currentThread) {
    chatInfoBody.innerHTML = '<div style="padding: 24px 16px; text-align: center; color: #64748B;">Vui lòng chọn một cuộc trò chuyện để xem thông tin</div>';
    return;
  }

  const msgs = currentThread.messages || [];

  // 1. Trích xuất Ảnh & Video (Media)
  const mediaList = msgs.filter(m => {
    if (m.isUndo || m.isRevoked || m.isRecalled) return false;
    if (m.isPhoto || m.isVideo) return true;
    if (m.photoUrl || m.videoUrl) return true;
    if (typeof m.content === 'string') {
      return m.content.match(/^https?:\/\/[^\s]+(\.(jpg|jpeg|png|webp|gif|mp4|mov)|\/jpg\/|\/png\/)/i) || m.content.includes('.zdn.vn/');
    }
    return false;
  }).map(m => ({
    url: m.photoUrl || m.thumbUrl || m.videoUrl || m.content,
    isVideo: m.isVideo || (typeof m.content === 'string' && m.content.match(/\.(mp4|mov)/i)),
    time: m.time,
    senderName: m.senderName
  }));

  // 2. Trích xuất Files / Tài liệu
  const filesList = msgs.filter(m => {
    if (m.isUndo || m.isRevoked || m.isRecalled) return false;
    if (m.isFile) return true;
    if (typeof m.content === 'string') {
      return m.content.startsWith('[Tài liệu:') || m.content.match(/^https?:\/\/[^\s]+(\.(pdf|docx|xlsx|pptx|zip|rar|7z|txt|csv|tar|gz))/i);
    }
    return false;
  }).map(m => {
    let name = m.fileName;
    if (!name && typeof m.content === 'string') {
      if (m.content.startsWith('[Tài liệu:')) {
        name = m.content.replace(/^\[Tài liệu:\s*|\]$/g, '');
      } else {
        name = m.content.split('/').pop().split('?')[0];
      }
    }
    return {
      name: name || 'Tài liệu Zalo',
      url: m.fileUrl || (typeof m.content === 'string' && m.content.startsWith('http') ? m.content : ''),
      size: m.fileSize || 0,
      time: m.time,
      senderName: m.senderName
    };
  });

  // 3. Trích xuất Links liên kết
  const linksList = [];
  msgs.forEach(m => {
    if (m.isUndo || m.isRevoked || m.isRecalled) return;
    if (m.isPhoto || m.isVideo || m.isFile || m.isSticker) return;
    const text = typeof m.content === 'string' ? m.content : '';
    const match = text.match(/https?:\/\/[^\s]+/gi);
    if (match) {
      match.forEach(u => {
        let domain = '';
        try { domain = new URL(u).hostname; } catch (e) { domain = 'link'; }
        linksList.push({
          url: u,
          domain: domain,
          time: m.time,
          senderName: m.senderName
        });
      });
    }
  });

  // 4. Lấy danh sách thành viên nếu là nhóm
  let membersList = [];
  if (currentThread.isGroup) {
    const memberMap = new Map();
    msgs.forEach(m => {
      if (m.senderId && m.senderName && !memberMap.has(m.senderId)) {
        memberMap.set(m.senderId, {
          id: m.senderId,
          name: m.senderName,
          avatar: m.avatar || ''
        });
      }
    });
    membersList = Array.from(memberMap.values());
  }

  // Header thông tin hội thoại
  const initial = (currentThread.senderName || 'Z')[0].toUpperCase();
  const avatarHtml = currentThread.avatar
    ? `<img src="${escapeHTML(currentThread.avatar)}" class="info-avatar-img" onerror="this.style.display='none';">`
    : `<span class="info-avatar-letter">${escapeHTML(initial)}</span>`;

  let bodyContentHtml = '';

  // Hàm chọn icon tệp tin chuẩn Zalo
  const getFileIconSrc = (fileName = '') => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '../assets/zalo-icons/File_Excel_48_Colored.svg';
    if (['doc', 'docx'].includes(ext)) return '../assets/zalo-icons/File_Word_48_Colored.svg';
    if (['pdf'].includes(ext)) return '../assets/zalo-icons/File_Pdf_48_Colored.svg';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '../assets/zalo-icons/File_Zip_48_Colored.svg';
    return '../assets/zalo-icons/File_Attachment_48_Colored.svg';
  };

  if (currentInfoTab === 'media') {
    if (mediaList.length === 0) {
      bodyContentHtml = `
        <div class="info-empty-state">
          <div class="info-empty-icon">
            <img src="../assets/zalo-icons/Media_Photo.svg" width="48" height="48" alt="Ảnh/Video" style="opacity: 0.6; filter: grayscale(20%);">
          </div>
          <div class="info-empty-title">Chưa có ảnh/video</div>
          <div class="info-empty-text">Hình ảnh và video được chia sẻ trong hội thoại này sẽ xuất hiện tại đây.</div>
        </div>
      `;
    } else {
      bodyContentHtml = `
        <div class="info-media-grid">
          ${mediaList.map(item => `
            <div class="info-media-thumb" data-src="${escapeHTML(item.url)}" title="Gửi bởi ${escapeHTML(item.senderName || '')} (${escapeHTML(item.time || '')})">
              ${item.isVideo 
                ? `<video src="${escapeHTML(item.url)}" class="info-thumb-media"></video><span class="video-badge">▶</span>` 
                : `<img src="${escapeHTML(item.url)}" class="info-thumb-media" loading="lazy" alt="Media" onerror="this.onerror=null; this.src='../assets/zalo-icons/icon-photo.svg';">`}
              <div class="info-thumb-overlay">🔍 Phóng to</div>
            </div>
          `).join('')}
        </div>
      `;
    }
  } else if (currentInfoTab === 'files') {
    if (filesList.length === 0) {
      bodyContentHtml = `
        <div class="info-empty-state">
          <div class="info-empty-icon">
            <img src="../assets/zalo-icons/icon-empty-files.svg" width="56" height="56" alt="Tệp tin" style="opacity: 0.7;">
          </div>
          <div class="info-empty-title">Chưa có file nào</div>
          <div class="info-empty-text">Tất cả tài liệu Word, Excel, PDF, Zip... được gửi sẽ được lưu trữ tại đây.</div>
        </div>
      `;
    } else {
      bodyContentHtml = `
        <div class="info-files-list">
          ${filesList.map(item => {
            const iconSrc = getFileIconSrc(item.name);
            const localSaved = downloadedFilePaths.get(item.url);
            return `
              <div class="info-file-item">
                <img src="${iconSrc}" class="info-file-zalo-icon" width="34" height="34" alt="File">
                <div class="info-file-details">
                  <div class="info-file-title" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
                  <div class="info-file-sub">${escapeHTML(item.senderName || '')} • ${escapeHTML(item.time || '')}</div>
                </div>
                ${item.url ? `
                  <div class="info-file-actions" style="display: flex; gap: 4px; align-items: center;">
                    ${localSaved ? `
                      <button class="btn-file-open" data-local-path="${escapeHTML(localSaved)}" title="Mở tệp tin">📄 Mở</button>
                      <button class="btn-file-folder" data-local-path="${escapeHTML(localSaved)}" title="Mở thư mục chứa">📂</button>
                    ` : `
                      <button class="btn-info-file-dl btn-file-download-quick" data-file-url="${escapeHTML(item.url)}" data-file-name="${escapeHTML(item.name)}" data-save-as="false" title="Tải về máy">📥 Tải</button>
                      <button class="btn-info-file-dl btn-file-download-saveas" data-file-url="${escapeHTML(item.url)}" data-file-name="${escapeHTML(item.name)}" data-save-as="true" title="Chọn nơi lưu...">💾</button>
                    `}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } else if (currentInfoTab === 'links') {
    if (linksList.length === 0) {
      bodyContentHtml = `
        <div class="info-empty-state">
          <div class="info-empty-icon">
            <img src="../assets/zalo-icons/icon-empty-links.svg" width="56" height="56" alt="Liên kết" style="opacity: 0.7;">
          </div>
          <div class="info-empty-title">Chưa có liên kết</div>
          <div class="info-empty-text">Các đường dẫn website được gửi trong cuộc trò chuyện sẽ được tổng hợp ở đây.</div>
        </div>
      `;
    } else {
      bodyContentHtml = `
        <div class="info-links-list">
          ${linksList.map(item => `
            <a href="${escapeHTML(item.url)}" target="_blank" class="info-link-item" title="${escapeHTML(item.url)}">
              <div class="info-link-icon">🔗</div>
              <div class="info-link-details">
                <div class="info-link-domain">${escapeHTML(item.domain)}</div>
                <div class="info-link-url">${escapeHTML(item.url)}</div>
                <div class="info-link-time">${escapeHTML(item.senderName || '')} • ${escapeHTML(item.time || '')}</div>
              </div>
              <div class="info-link-arrow">↗</div>
            </a>
          `).join('')}
        </div>
      `;
    }
  } else if (currentInfoTab === 'members' && currentThread.isGroup) {
    bodyContentHtml = `
      <div class="info-members-list">
        <div style="font-size: 12px; color: #94A3B8; margin-bottom: 8px; font-weight: 600;">Thành viên nhóm (${membersList.length})</div>
        ${membersList.map(m => `
          <div class="info-member-item">
            <div class="info-member-avatar">${(m.name || 'Z')[0].toUpperCase()}</div>
            <div class="info-member-name">${escapeHTML(m.name)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (currentInfoTab === 'board') {
    bodyContentHtml = '<div id="conversation-tools-list" class="conversation-tools-list" role="status">Đang tải bảng hội thoại...</div>';
  }

  const isThreadMuted = mutedThreadIds.has(String(currentThread.threadId));
  const isThreadPinned = pinnedThreadIds.has(String(currentThread.threadId));

  chatInfoBody.innerHTML = `
    <!-- 1. Profile Box -->
    <div class="info-profile-box">
      <div class="info-avatar-wrap" style="${currentThread.isGroup ? 'background: linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%);' : 'background: linear-gradient(135deg, #0084FF 0%, #0052CC 100%);'}">
        ${avatarHtml}
      </div>
      <h3 class="info-profile-name">${escapeHTML(currentThread.senderName)}</h3>
      <div class="info-profile-type">${currentThread.isGroup ? `Nhóm Zalo • ${currentThread.totalMember || membersList.length} thành viên` : 'Cuộc trò chuyện cá nhân'}</div>
      
      <!-- Nút thao tác nhanh: Mute & Pin -->
      <div class="info-quick-actions">
        <button class="info-action-btn ${isThreadMuted ? 'active' : ''}" id="info-btn-mute" title="${isThreadMuted ? 'Bật lại thông báo' : 'Tắt thông báo'}">
          <span class="info-act-icon">${isThreadMuted ? '🔕' : '🔔'}</span>
          <span class="info-act-label">${isThreadMuted ? 'Đang tắt chuông' : 'Tắt thông báo'}</span>
        </button>
        <button class="info-action-btn ${isThreadPinned ? 'active' : ''}" id="info-btn-pin" title="${isThreadPinned ? 'Bỏ ghim' : 'Ghim hội thoại'}">
          <span class="info-act-icon">📌</span>
          <span class="info-act-label">${isThreadPinned ? 'Đã ghim' : 'Ghim hội thoại'}</span>
        </button>
      </div>
    </div>

    <!-- 2. Tabs phân loại tiện ích -->
    <div class="info-tabs-bar">
      <button class="info-tab-btn ${currentInfoTab === 'media' ? 'active' : ''}" data-infotab="media">
        <span>🖼️ Ảnh/Video</span>
        <span class="info-tab-badge">${mediaList.length}</span>
      </button>
      <button class="info-tab-btn ${currentInfoTab === 'files' ? 'active' : ''}" data-infotab="files">
        <span>📁 File</span>
        <span class="info-tab-badge">${filesList.length}</span>
      </button>
      <button class="info-tab-btn ${currentInfoTab === 'links' ? 'active' : ''}" data-infotab="links">
        <span>🔗 Link</span>
        <span class="info-tab-badge">${linksList.length}</span>
      </button>
      ${currentThread.isGroup ? `
      <button class="info-tab-btn ${currentInfoTab === 'members' ? 'active' : ''}" data-infotab="members">
        <span>👥 Thành viên</span>
      </button>
      ` : ''}
      <button class="info-tab-btn ${currentInfoTab === 'board' ? 'active' : ''}" data-infotab="board">
        <span>Bảng & nhắc hẹn</span>
      </button>
    </div>

    <!-- 3. Nội dung Tab -->
    <div class="info-tab-content-wrap">
      ${bodyContentHtml}
    </div>
  `;

  if (currentInfoTab === 'board') {
    renderConversationTools(chatInfoBody.querySelector('#conversation-tools-list'), currentThread);
  }

  // Bắt sự kiện bấm nút Mute trong Info Panel
  const infoBtnMute = document.getElementById('info-btn-mute');
  if (infoBtnMute) {
    infoBtnMute.addEventListener('click', async () => {
      const targetState = !isThreadMuted;
      if (window.electronAPI && window.electronAPI.setThreadMute) {
        try {
          const result = await window.electronAPI.setThreadMute(currentThread.threadId, targetState, currentThread.isGroup, -1);
          if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
          if (targetState) {
            mutedThreadIds.add(String(currentThread.threadId));
            showToast(`Đã tắt thông báo "${currentThread.senderName}".`, 'info');
          } else {
            mutedThreadIds.delete(String(currentThread.threadId));
            showToast(`Đã bật lại thông báo "${currentThread.senderName}".`, 'success');
          }
          renderDashboardFeed();
          renderActiveChatThread();
        } catch (e) {
          showToast('Lỗi cập nhật tắt thông báo: ' + e.message, 'error');
        }
      }
    });
  }

  // Bắt sự kiện bấm nút Pin trong Info Panel
  const infoBtnPin = document.getElementById('info-btn-pin');
  if (infoBtnPin) {
    infoBtnPin.addEventListener('click', async () => {
      const targetState = !isThreadPinned;
      if (window.electronAPI && window.electronAPI.setPinnedConversation) {
        try {
          const result = await window.electronAPI.setPinnedConversation(currentThread.threadId, targetState, currentThread.isGroup);
          if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
          if (targetState) {
            pinnedThreadIds.add(String(currentThread.threadId));
            showToast(`Đã ghim hội thoại "${currentThread.senderName}".`, 'success');
          } else {
            pinnedThreadIds.delete(String(currentThread.threadId));
            showToast(`Đã bỏ ghim hội thoại "${currentThread.senderName}".`, 'info');
          }
          renderDashboardFeed();
          renderActiveChatThread();
        } catch (e) {
          showToast('Lỗi ghim hội thoại: ' + e.message, 'error');
        }
      }
    });
  }

  // Bắt sự kiện chuyển tab trong Info Panel
  const tabBtns = chatInfoBody.querySelectorAll('.info-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-infotab');
      if (target) {
        currentInfoTab = target;
        renderConversationInfoPanel();
      }
    });
  });

  // Bắt sự kiện click vào ảnh Media để mở Lightbox
  const mediaThumbs = chatInfoBody.querySelectorAll('.info-media-thumb');
  mediaThumbs.forEach(thumb => {
    thumb.addEventListener('click', () => {
      const src = thumb.getAttribute('data-src');
      if (src && typeof openLightbox === 'function') {
        openLightbox(src);
      }
    });
  });

  // Bắt sự kiện tải tệp tin từ Info Panel
  const fileDlBtns = chatInfoBody.querySelectorAll('.btn-info-file-dl');
  fileDlBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fUrl = btn.getAttribute('data-file-url');
      const fName = btn.getAttribute('data-file-name');
      const isSaveAs = btn.getAttribute('data-save-as') === 'true';
      handleDownloadFile(fUrl, fName, isSaveAs, btn);
    });
  });

  // Bắt sự kiện mở tệp & thư mục đã tải trong Info Panel
  const infoOpenBtns = chatInfoBody.querySelectorAll('.btn-file-open');
  infoOpenBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lPath = btn.getAttribute('data-local-path');
      if (lPath && window.electronAPI && window.electronAPI.openFilePath) {
        window.electronAPI.openFilePath(lPath);
      }
    });
  });

  const infoFolderBtns = chatInfoBody.querySelectorAll('.btn-file-folder');
  infoFolderBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lPath = btn.getAttribute('data-local-path');
      if (lPath && window.electronAPI && window.electronAPI.showItemInFolder) {
        window.electronAPI.showItemInFolder(lPath);
      }
    });
  });
}

// Gắn sự kiện mở/đóng Panel Thông tin hội thoại
if (btnToggleInfoPanel) {
  btnToggleInfoPanel.addEventListener('click', () => {
    toggleConversationInfoPanel();
  });
}
if (btnCloseInfoPanel) {
  btnCloseInfoPanel.addEventListener('click', () => {
    toggleConversationInfoPanel(false);
  });
}

// ============================================================
// 12. TÍNH NĂNG ƯU TIÊN 1: CONTEXT MENU (CHUỘT PHẢI TIN NHẮN)
// ============================================================
let ctxCurrentMsg = null;
let ctxCurrentThread = null;
let ctxSelectedText = '';

function showChatContextMenu(e, msg, thread) {
  if (!chatContextMenu) return;
  // Không hiển thị menu cho tin nhắn đã bị thu hồi
  const isRevoked = Boolean(
    msg.isUndo || 
    msg.isRevoked || 
    msg.isRecalled || 
    msg.content === 'Tin nhắn đã được thu hồi' || 
    msg.content === '[Tin nhắn đã bị xóa]' || 
    (typeof msg.content === 'string' && msg.content.includes('Tin nhắn đã được thu hồi'))
  );
  if (isRevoked) return;

  ctxCurrentMsg = msg;
  ctxCurrentThread = thread || getGroupedThreads().find(t => String(t.threadId) === String(activeThreadId));
  const selection = window.getSelection();
  const messageRow = e.currentTarget;
  ctxSelectedText = selection && messageRow?.contains(selection.anchorNode) && messageRow.contains(selection.focusNode)
    ? selection.toString() : '';

  // 1. Sao chép liên kết (chỉ hiện khi tin nhắn có đường link URL)
  const hasLink = typeof msg.content === 'string' && /https?:\/\/[^\s]+/i.test(msg.content);
  if (ctxCopyLink) ctxCopyLink.style.display = hasLink ? 'flex' : 'none';

  // 2. Tùy chọn Tệp tin (chỉ hiện khi tin nhắn là file)
  const isFile = Boolean(msg.isFile || msg.fileUrl || (typeof msg.content === 'string' && msg.content.startsWith('[Tài liệu:')));
  const fUrl = msg.fileUrl || '';
  const localSavedPath = downloadedFilePaths.get(fUrl);

  if (ctxFileDivider) ctxFileDivider.style.display = isFile ? 'block' : 'none';
  if (ctxDownloadFile) ctxDownloadFile.style.display = (isFile && !localSavedPath) ? 'flex' : 'none';
  if (ctxOpenFile) ctxOpenFile.style.display = (isFile && localSavedPath) ? 'flex' : 'none';
  if (ctxShowFolder) ctxShowFolder.style.display = (isFile && localSavedPath) ? 'flex' : 'none';

  // 3. Tùy chọn Thu hồi tin nhắn (chỉ hiện cho tin nhắn do chính mình gửi)
  const isSelf = Boolean(msg.isSelf);
  if (ctxUndoDivider) ctxUndoDivider.style.display = isSelf ? 'block' : 'none';
  if (ctxUndoMsg) ctxUndoMsg.style.display = isSelf ? 'flex' : 'none';

  // 4. Tùy chọn Ghim / Gỡ ghim tin nhắn
  if (ctxPinMsg && ctxPinLabel && ctxCurrentThread) {
    const pinnedList = getPinnedMessages(ctxCurrentThread.threadId);
    const isAlreadyPinned = pinnedList.some(m => String(m.id) === String(msg.id));
    ctxPinLabel.textContent = isAlreadyPinned ? 'Gỡ ghim tin nhắn' : 'Ghim tin nhắn';
    ctxPinMsg.style.display = 'flex';
  }

  // Định vị Menu chuột phải không vượt ngoài màn hình
  chatContextMenu.style.display = 'block';
  const menuWidth = 210;
  const menuHeight = chatContextMenu.offsetHeight || 260;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }

  chatContextMenu.style.left = `${Math.max(10, posX)}px`;
  chatContextMenu.style.top = `${Math.max(10, posY)}px`;
}

function hideChatContextMenu() {
  if (chatContextMenu) {
    chatContextMenu.style.display = 'none';
  }
  ctxCurrentMsg = null;
  ctxCurrentThread = null;
  ctxSelectedText = '';
}

// Bắt sự kiện click ra ngoài để ẩn Context Menu
document.addEventListener('click', (e) => {
  if (chatContextMenu && chatContextMenu.style.display !== 'none') {
    if (!chatContextMenu.contains(e.target)) {
      hideChatContextMenu();
    }
  }
});

// Bắt sự kiện cuộn trang hoặc resize để ẩn Context Menu
if (chatMessagesScroll) {
  chatMessagesScroll.addEventListener('scroll', hideChatContextMenu, { passive: true });
}
window.addEventListener('resize', hideChatContextMenu);

// Gắn sự kiện các nút trong Context Menu
if (ctxCopyText) {
  ctxCopyText.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      const textToCopy = ctxSelectedText || ctxCurrentMsg.content || '';
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast('Đã sao chép nội dung tin nhắn', 'success');
      }).catch(() => {
        showToast('Không thể sao chép văn bản', 'error');
      });
    }
    hideChatContextMenu();
  });
}

if (ctxCopyLink) {
  ctxCopyLink.addEventListener('click', () => {
    if (ctxCurrentMsg && typeof ctxCurrentMsg.content === 'string') {
      const match = ctxCurrentMsg.content.match(/https?:\/\/[^\s]+/i);
      if (match) {
        navigator.clipboard.writeText(match[0]).then(() => {
          showToast('Đã sao chép liên kết vào bộ nhớ tạm', 'success');
        }).catch(() => {
          showToast('Không thể sao chép liên kết', 'error');
        });
      }
    }
    hideChatContextMenu();
  });
}

if (ctxForwardMsg) {
  ctxForwardMsg.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      openForwardModal(ctxCurrentMsg, ctxCurrentThread);
    }
    hideChatContextMenu();
  });
}

if (ctxReplyMsg) {
  ctxReplyMsg.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      replyingToMessage = ctxCurrentMsg;
      if (chatQuoteBar && chatQuoteTitle && chatQuoteText) {
        chatQuoteTitle.textContent = `Trả lời: ${ctxCurrentMsg.isSelf ? 'Bạn (Tôi)' : ctxCurrentMsg.senderName}`;
        chatQuoteText.textContent = ctxCurrentMsg.content || '';
        chatQuoteBar.style.display = 'flex';
      }
      if (chatReplyInput) chatReplyInput.focus();
    }
    hideChatContextMenu();
  });
}

if (ctxPinMsg) {
  ctxPinMsg.addEventListener('click', () => {
    if (ctxCurrentMsg && ctxCurrentThread) {
      togglePinMessage(ctxCurrentMsg, ctxCurrentThread.threadId);
    }
    hideChatContextMenu();
  });
}

if (ctxDownloadFile) {
  ctxDownloadFile.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      const fUrl = ctxCurrentMsg.fileUrl || '';
      const fName = ctxCurrentMsg.fileName || (typeof ctxCurrentMsg.content === 'string' ? ctxCurrentMsg.content.replace(/^\[Tài liệu:\s*|\]$/g, '') : 'Tệp tin Zalo');
      handleDownloadFile(fUrl, fName, false);
    }
    hideChatContextMenu();
  });
}

if (ctxOpenFile) {
  ctxOpenFile.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      const fUrl = ctxCurrentMsg.fileUrl || '';
      const localPath = downloadedFilePaths.get(fUrl);
      if (localPath && window.electronAPI && window.electronAPI.openFilePath) {
        window.electronAPI.openFilePath(localPath);
      }
    }
    hideChatContextMenu();
  });
}

if (ctxShowFolder) {
  ctxShowFolder.addEventListener('click', () => {
    if (ctxCurrentMsg) {
      const fUrl = ctxCurrentMsg.fileUrl || '';
      const localPath = downloadedFilePaths.get(fUrl);
      if (localPath && window.electronAPI && window.electronAPI.showItemInFolder) {
        window.electronAPI.showItemInFolder(localPath);
      }
    }
    hideChatContextMenu();
  });
}

if (ctxUndoMsg) {
  ctxUndoMsg.addEventListener('click', async () => {
    if (ctxCurrentMsg && ctxCurrentThread) {
      const msgToUndo = ctxCurrentMsg;
      const targetThread = ctxCurrentThread;
      hideChatContextMenu();
      if (confirm('Bạn có chắc muốn thu hồi tin nhắn này với mọi người không?')) {
        if (window.electronAPI && window.electronAPI.undoMessage) {
          try {
            await window.electronAPI.undoMessage(targetThread.threadId, msgToUndo.id, msgToUndo.cliMsgId, targetThread.isGroup);
            msgToUndo.content = 'Tin nhắn đã được thu hồi';
            msgToUndo.isRevoked = true;
            renderActiveChatThread();
            showToast('Đã thu hồi tin nhắn thành công!', 'success');
          } catch (err) {
            showToast('Lỗi thu hồi: ' + err.message, 'error');
          }
        }
      }
    } else {
      hideChatContextMenu();
    }
  });
}

// ============================================================
// 13. TÍNH NĂNG ƯU TIÊN 1: MODAL CHUYỂN TIẾP TIN NHẮN (FORWARD)
// ============================================================
let forwardSourceMessage = null;
let forwardTargetSelected = null;

function openForwardModal(msg, thread) {
  if (!forwardModalOverlay) return;
  forwardSourceMessage = msg;
  forwardTargetSelected = null;

  // Hiển thị nội dung xem trước
  if (forwardPreviewContent) {
    if (msg.isPhoto) {
      forwardPreviewContent.innerHTML = '<span style="color: #38BDF8;">🖼️ [Hình ảnh]</span>';
    } else if (msg.isSticker) {
      forwardPreviewContent.innerHTML = '<span style="color: #F59E0B;">🎨 [Sticker Zalo]</span>';
    } else if (msg.isFile || (typeof msg.content === 'string' && msg.content.startsWith('[Tài liệu:'))) {
      const fName = msg.fileName || msg.content;
      forwardPreviewContent.innerHTML = `<span style="color: #10B981;">📄 [Tệp tin]</span> ${escapeHTML(fName)}`;
    } else if (msg.isVideo) {
      forwardPreviewContent.innerHTML = '<span style="color: #EC4899;">🎬 [Video]</span>';
    } else {
      forwardPreviewContent.textContent = msg.content || '';
    }
  }

  if (forwardSearchInput) forwardSearchInput.value = '';
  if (forwardSelectedHint) forwardSelectedHint.textContent = 'Chưa chọn người nhận';
  if (btnConfirmForward) {
    btnConfirmForward.disabled = true;
    btnConfirmForward.textContent = 'Gửi chuyển tiếp';
  }

  renderForwardTargetsList('');
  forwardModalOverlay.style.display = 'flex';
  if (forwardSearchInput) forwardSearchInput.focus();
}

function closeForwardModal() {
  if (forwardModalOverlay) {
    forwardModalOverlay.style.display = 'none';
  }
  forwardSourceMessage = null;
  forwardTargetSelected = null;
}

function renderForwardTargetsList(keyword = '') {
  if (!forwardTargetList) return;
  const kw = keyword.trim().toLowerCase();

  const threads = getGroupedThreads();
  const targets = [];
  const addedIds = new Set();

  // Hội thoại gần đây
  threads.forEach(t => {
    const sId = String(t.threadId);
    if (!addedIds.has(sId)) {
      addedIds.add(sId);
      targets.push({
        threadId: t.threadId,
        name: t.senderName || 'Hội thoại',
        avatar: t.avatar,
        isGroup: !!t.isGroup,
      });
    }
  });

  // Bạn bè khác
  if (Array.isArray(allFriendsList)) {
    allFriendsList.forEach(f => {
      const sId = String(f.userId);
      if (!addedIds.has(sId)) {
        addedIds.add(sId);
        targets.push({
          threadId: f.userId,
          name: f.displayName || f.zaloName || f.name || 'Bạn bè Zalo',
          avatar: f.avatar,
          isGroup: false,
        });
      }
    });
  }

  // Nhóm khác
  if (Array.isArray(allGroupsList)) {
    allGroupsList.forEach(g => {
      const sId = String(g.groupId);
      if (!addedIds.has(sId)) {
        addedIds.add(sId);
        targets.push({
          threadId: g.groupId,
          name: g.name || 'Nhóm Zalo',
          avatar: g.avatar,
          isGroup: true,
        });
      }
    });
  }

  // Lọc theo từ khóa
  const filtered = kw 
    ? targets.filter(t => (t.name && t.name.toLowerCase().includes(kw)))
    : targets;

  forwardTargetList.innerHTML = '';
  if (filtered.length === 0) {
    forwardTargetList.innerHTML = `
      <div style="text-align: center; color: #64748B; font-size: 13px; padding: 25px 10px;">
        Không tìm thấy bạn bè hoặc nhóm nào phù hợp với "${escapeHTML(keyword)}"
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    const isSelected = forwardTargetSelected && String(forwardTargetSelected.threadId) === String(item.threadId);
    card.className = `forward-target-item ${isSelected ? 'selected' : ''}`;

    const initial = (item.name || 'Z')[0].toUpperCase();
    const avatarHtml = item.avatar
      ? `<img src="${escapeHTML(item.avatar)}" alt="${escapeHTML(item.name)}" onerror="this.style.display='none';">`
      : escapeHTML(initial);

    card.innerHTML = `
      <div class="forward-item-avatar" style="background: ${item.isGroup ? 'linear-gradient(135deg, #8B5CF6, #6D28D9)' : 'linear-gradient(135deg, #0084FF, #0052CC)'};">
        ${avatarHtml}
      </div>
      <div class="forward-item-info">
        <div class="forward-item-name">
          ${escapeHTML(item.name)}
        </div>
        <div class="forward-item-type">${item.isGroup ? 'Nhóm Zalo' : 'Tin nhắn cá nhân'}</div>
      </div>
      <div class="forward-item-check">${isSelected ? '✓' : ''}</div>
    `;

    card.addEventListener('click', () => {
      forwardTargetSelected = item;
      if (forwardSelectedHint) {
        forwardSelectedHint.innerHTML = `Đã chọn: <strong style="color: #38BDF8;">${escapeHTML(item.name)}</strong>`;
      }
      if (btnConfirmForward) {
        btnConfirmForward.disabled = false;
      }
      // Cập nhật lại UI highlight các card
      const allCards = forwardTargetList.querySelectorAll('.forward-target-item');
      allCards.forEach(c => c.classList.remove('selected'));
      const allChecks = forwardTargetList.querySelectorAll('.forward-item-check');
      allChecks.forEach(ch => ch.textContent = '');

      card.classList.add('selected');
      const checkEl = card.querySelector('.forward-item-check');
      if (checkEl) checkEl.textContent = '✓';
    });

    forwardTargetList.appendChild(card);
  });
}

// Bắt sự kiện tìm kiếm người nhận trong Forward Modal
if (forwardSearchInput) {
  forwardSearchInput.addEventListener('input', () => {
    renderForwardTargetsList(forwardSearchInput.value);
  });
}

// Bắt sự kiện Đóng / Hủy Forward Modal
if (btnCloseForwardModal) {
  btnCloseForwardModal.addEventListener('click', closeForwardModal);
}
if (btnCancelForward) {
  btnCancelForward.addEventListener('click', closeForwardModal);
}
if (forwardModalOverlay) {
  forwardModalOverlay.addEventListener('click', (e) => {
    if (e.target === forwardModalOverlay) closeForwardModal();
  });
}

// Bắt sự kiện Gửi chuyển tiếp
if (btnConfirmForward) {
  btnConfirmForward.addEventListener('click', async () => {
    if (!forwardSourceMessage || !forwardTargetSelected) return;

    btnConfirmForward.disabled = true;
    btnConfirmForward.textContent = 'Đang gửi chuyển tiếp...';

    const targetThreadId = forwardTargetSelected.threadId;
    const isGroup = !!forwardTargetSelected.isGroup;
    const targetName = forwardTargetSelected.name;

    try {
      if (!window.electronAPI?.forwardTextMessage) throw new Error('Chức năng chuyển tiếp chưa khả dụng');
      const result = await window.electronAPI.forwardTextMessage(forwardSourceMessage, targetThreadId, isGroup);
      if (!result?.success) throw new Error(result?.error || 'Chuyển tiếp thất bại');

      showToast(`Đã chuyển tiếp tin nhắn tới "${targetName}" thành công!`, 'success');
      closeForwardModal();
      
      // Nếu đang mở đúng cuộc trò chuyện người nhận, render lại
      if (String(activeThreadId) === String(targetThreadId)) {
        renderActiveChatThread();
      }
    } catch (err) {
      showToast('Lỗi chuyển tiếp tin nhắn: ' + err.message, 'error');
      btnConfirmForward.disabled = false;
      btnConfirmForward.textContent = 'Gửi chuyển tiếp';
    }
  });
}

// ============================================================
// 14. TÍNH NĂNG ƯU TIÊN 1: TÌM KIẾM TIN NHẮN (IN-CHAT SEARCH)
// ============================================================
let isInchatSearchOpen = false;
let inchatMatches = []; // array of { row, bubbleEl, origContent }
let currentInchatMatchIdx = -1;

function toggleInchatSearch(forceOpen) {
  if (forceOpen === undefined) {
    isInchatSearchOpen = !isInchatSearchOpen;
  } else {
    isInchatSearchOpen = !!forceOpen;
  }

  if (btnToggleInchatSearch) {
    btnToggleInchatSearch.classList.toggle('active', isInchatSearchOpen);
  }

  if (inchatSearchBar) {
    inchatSearchBar.style.display = isInchatSearchOpen ? 'flex' : 'none';
  }

  if (isInchatSearchOpen) {
    if (inchatSearchInput) {
      inchatSearchInput.focus();
      inchatSearchInput.select();
      if (inchatSearchInput.value.trim()) {
        performInchatSearch();
      }
    }
  } else {
    clearInchatHighlights();
    inchatMatches = [];
    currentInchatMatchIdx = -1;
    if (inchatSearchCount) inchatSearchCount.textContent = '0 kết quả';
  }
}

function clearInchatHighlights() {
  if (Array.isArray(inchatMatches) && inchatMatches.length > 0) {
    inchatMatches.forEach(item => {
      if (item && item.bubbleEl && item.origContent !== undefined) {
        item.bubbleEl.innerHTML = item.origContent;
      }
    });
  }
}

function performInchatSearch() {
  clearInchatHighlights();
  inchatMatches = [];
  currentInchatMatchIdx = -1;

  if (!inchatSearchInput || !chatMessagesScroll) return;
  const query = inchatSearchInput.value.trim();

  if (!query) {
    if (inchatSearchCount) inchatSearchCount.textContent = '0 kết quả';
    return;
  }

  const escapedKw = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedKw})`, 'gi');

  const rows = chatMessagesScroll.querySelectorAll('.chat-msg-row');
  rows.forEach(row => {
    // Không tìm trong tin nhắn thu hồi
    if (row.querySelector('.revoked-bubble')) return;

    const bubble = row.querySelector('.chat-bubble:not(.revoked-bubble)') || row.querySelector('.file-name');
    if (!bubble) return;

    const rawText = bubble.innerText || bubble.textContent || '';
    if (regex.test(rawText)) {
      const origContent = bubble.innerHTML;
      // Highlight an toàn bằng cách thay thế văn bản
      bubble.innerHTML = origContent.replace(regex, '<span class="search-highlight">$1</span>');
      inchatMatches.push({
        row: row,
        bubbleEl: bubble,
        origContent: origContent
      });
    }
  });

  if (inchatMatches.length === 0) {
    if (inchatSearchCount) inchatSearchCount.textContent = '0 kết quả';
  } else {
    // Mặc định nhảy tới kết quả gần nhất (cuối cùng)
    currentInchatMatchIdx = inchatMatches.length - 1;
    focusInchatMatch(currentInchatMatchIdx);
  }
}

function focusInchatMatch(idx) {
  if (!Array.isArray(inchatMatches) || inchatMatches.length === 0) return;
  if (idx < 0 || idx >= inchatMatches.length) return;

  // Xóa class .current trên tất cả các highlight cũ
  const allHighlights = chatMessagesScroll.querySelectorAll('.search-highlight');
  allHighlights.forEach(h => h.classList.remove('current'));

  const currentMatch = inchatMatches[idx];
  if (currentMatch && currentMatch.bubbleEl) {
    const highlightsInBubble = currentMatch.bubbleEl.querySelectorAll('.search-highlight');
    highlightsInBubble.forEach(h => h.classList.add('current'));

    // Cuộn mượt tới tin nhắn khớp
    if (currentMatch.row) {
      currentMatch.row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  if (inchatSearchCount) {
    inchatSearchCount.textContent = `${idx + 1}/${inchatMatches.length} kết quả`;
  }
}

// Bắt sự kiện cho các nút điều hướng tìm kiếm
if (btnToggleInchatSearch) {
  btnToggleInchatSearch.addEventListener('click', () => {
    toggleInchatSearch();
  });
}

if (btnInchatSearchClose) {
  btnInchatSearchClose.addEventListener('click', () => {
    toggleInchatSearch(false);
  });
}

if (btnInchatSearchPrev) {
  btnInchatSearchPrev.addEventListener('click', () => {
    if (inchatMatches.length > 0) {
      currentInchatMatchIdx = (currentInchatMatchIdx - 1 + inchatMatches.length) % inchatMatches.length;
      focusInchatMatch(currentInchatMatchIdx);
    }
  });
}

if (btnInchatSearchNext) {
  btnInchatSearchNext.addEventListener('click', () => {
    if (inchatMatches.length > 0) {
      currentInchatMatchIdx = (currentInchatMatchIdx + 1) % inchatMatches.length;
      focusInchatMatch(currentInchatMatchIdx);
    }
  });
}

if (inchatSearchInput) {
  inchatSearchInput.addEventListener('input', performInchatSearch);
  inchatSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (btnInchatSearchPrev) btnInchatSearchPrev.click();
      } else {
        if (btnInchatSearchNext) btnInchatSearchNext.click();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleInchatSearch(false);
    }
  });
}

// Phím tắt bàn phím toàn cục: Ctrl+F để mở tìm kiếm tin nhắn trong hội thoại
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    // Chỉ kích hoạt khi đang ở tab Tin nhắn và đã có cuộc trò chuyện đang mở
    if (currentTab === 'tab-messages' && activeThreadId) {
      e.preventDefault();
      toggleInchatSearch(true);
    }
  } else if (e.key === 'Escape') {
    if (isInchatSearchOpen) {
      toggleInchatSearch(false);
    }
    if (forwardModalOverlay && forwardModalOverlay.style.display === 'flex') {
      closeForwardModal();
    }
    hideChatContextMenu();
    hideConvContextMenu();
  }
});

// ============================================================
// 15. TÍNH NĂNG ƯU TIÊN 2: QUẢN LÝ TIN NHẮN GHIM (PINNED MESSAGES)
// ============================================================
const PINNED_STORAGE_KEY = 'nhitzalo_pinned_messages';
let currentPinnedViewIdx = 0;
const serverPinnedMessages = new Map();

function getVisiblePinnedMessages(threadId) {
  return window.pinnedMessages.mergePinnedMessages(
    getPinnedMessages(threadId), serverPinnedMessages.get(String(threadId))?.items || []
  );
}

async function loadServerPinnedMessages(thread) {
  if (!thread || thread.isCloud || !window.electronAPI?.getConversationTools) return;
  const threadId = String(thread.threadId);
  const cached = serverPinnedMessages.get(threadId);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.time < 30000) return;
  const pending = window.electronAPI.getConversationTools(threadId, !!thread.isGroup);
  serverPinnedMessages.set(threadId, { ...cached, pending });
  try {
    const result = await pending;
    serverPinnedMessages.set(threadId, {
      items: window.pinnedMessages.mergePinnedMessages(
        window.pinnedMessages.normalizePinnedTopics(result?.pinTopics),
        [...window.pinnedMessages.normalizePinnedBoards(result?.boards),
          ...window.pinnedMessages.normalizePinnedFriendBoards(result?.friendBoards)]
      ), time: Date.now()
    });
    if (String(activeThreadId) === threadId) renderPinnedMessageBar(thread);
  } catch (error) {
    serverPinnedMessages.delete(threadId);
    console.warn('Không thể tải tin nhắn ghim từ Zalo:', error);
  }
}

function getPinnedMessages(threadId) {
  try {
    const raw = accountStorage.getItem(PINNED_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return Array.isArray(map[String(threadId)]) ? map[String(threadId)] : [];
  } catch (e) {
    return [];
  }
}

function savePinnedMessages(threadId, list) {
  try {
    const raw = accountStorage.getItem(PINNED_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[String(threadId)] = list;
    accountStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {}
}

function togglePinMessage(msg, threadId) {
  const list = getPinnedMessages(threadId);
  const msgKey = String(msg.id || ('cli_' + (msg.cliMsgId || '')));
  const existingIdx = list.findIndex(m => String(m.id) === msgKey);

  if (existingIdx >= 0) {
    // Bỏ ghim
    list.splice(existingIdx, 1);
    savePinnedMessages(threadId, list);
    showToast('Đã bỏ ghim tin nhắn này.', 'info');
  } else {
    // Ghim tin nhắn mới
    let pinContent = window.CallMessage.describeCallMessage(msg);
    if (msg.isPhoto) pinContent = '[Hình ảnh]';
    else if (msg.isSticker) pinContent = '[Sticker]';
    else if (msg.isFile) pinContent = `[Tệp tin: ${msg.fileName || 'Tài liệu'}]`;
    else if (msg.isVideo) pinContent = '[Video]';

    const pinItem = {
      id: msgKey,
      senderName: msg.isSelf ? 'Bạn (Tôi)' : (msg.senderName || 'Tin nhắn'),
      content: pinContent,
      time: msg.time || '',
      timestamp: msg.timestamp || Date.now()
    };
    list.unshift(pinItem); // Đưa lên đầu danh sách ghim
    savePinnedMessages(threadId, list);
    showToast('Đã ghim tin nhắn lên đầu cuộc trò chuyện!', 'success');
  }

  currentPinnedViewIdx = 0;
  const currentThread = getGroupedThreads().find(t => String(t.threadId) === String(threadId));
  if (currentThread) {
    renderPinnedMessageBar(currentThread);
  }
}

function renderPinnedMessageBar(currentThread) {
  if (!chatPinnedBar || !currentThread) return;
  const list = getVisiblePinnedMessages(currentThread.threadId);

  if (list.length === 0) {
    chatPinnedBar.style.display = 'none';
    currentPinnedViewIdx = 0;
    return;
  }

  if (currentPinnedViewIdx >= list.length) currentPinnedViewIdx = list.length - 1;
  if (currentPinnedViewIdx < 0) currentPinnedViewIdx = 0;

  const pin = list[currentPinnedViewIdx];
  chatPinnedBar.style.display = 'flex';
  if (btnPinnedUnpin) btnPinnedUnpin.style.display = pin.source === 'zalo' ? 'none' : 'inline-block';

  if (pinnedBarSender) pinnedBarSender.textContent = `${pin.senderName}:`;
  if (pinnedBarText) pinnedBarText.textContent = pin.content;

  if (list.length > 1) {
    if (pinnedBarCount) {
      pinnedBarCount.style.display = 'inline-block';
      pinnedBarCount.textContent = `${currentPinnedViewIdx + 1}/${list.length}`;
    }
    if (btnPinnedPrev) btnPinnedPrev.style.display = 'inline-block';
    if (btnPinnedNext) btnPinnedNext.style.display = 'inline-block';
  } else {
    if (pinnedBarCount) pinnedBarCount.style.display = 'none';
    if (btnPinnedPrev) btnPinnedPrev.style.display = 'none';
    if (btnPinnedNext) btnPinnedNext.style.display = 'none';
  }

  // Click vào nội dung thanh ghim để cuộn tới tin nhắn
  if (pinnedBarContent) {
    pinnedBarContent.onclick = () => {
      scrollToAndHighlightMessage(pin.id);
    };
  }

  // Nút bỏ ghim
  if (btnPinnedUnpin) {
    btnPinnedUnpin.onclick = () => {
      if (confirm('Bạn có muốn gỡ bỏ ghim tin nhắn này không?')) {
        togglePinMessage(pin, currentThread.threadId);
      }
    };
  }
}

const btnShowPinned = document.getElementById('btn-show-pinned');
btnShowPinned?.addEventListener('click', async () => {
  const thread = getGroupedThreads().find(item => String(item.threadId) === String(activeThreadId));
  if (!thread) return;
  await loadServerPinnedMessages(thread);
  const list = getVisiblePinnedMessages(thread.threadId);
  if (list.length === 0) {
    showToast('Chưa có tin nhắn ghim. Nhấp chuột phải vào một tin nhắn rồi chọn Ghim tin nhắn.', 'info');
    return;
  }
  currentPinnedViewIdx = 0;
  renderPinnedMessageBar(thread);
  chatPinnedBar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function scrollToAndHighlightMessage(msgId) {
  if (!chatMessagesScroll) return;
  const rows = chatMessagesScroll.querySelectorAll('.chat-msg-row');
  for (const row of rows) {
    if (row.getAttribute('data-msg-id') === String(msgId)) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('pinned-target-blink');
      void row.offsetWidth; // force reflow
      row.classList.add('pinned-target-blink');
      return;
    }
  }
  showToast('Tin nhắn này ở xa trong lịch sử hoặc chưa được tải trên máy.', 'info');
}

if (btnPinnedPrev) {
  btnPinnedPrev.addEventListener('click', () => {
    if (!activeThreadId) return;
    const list = getVisiblePinnedMessages(activeThreadId);
    if (list.length > 0) {
      currentPinnedViewIdx = (currentPinnedViewIdx - 1 + list.length) % list.length;
      const currentThread = getGroupedThreads().find(t => String(t.threadId) === String(activeThreadId));
      if (currentThread) renderPinnedMessageBar(currentThread);
    }
  });
}

if (btnPinnedNext) {
  btnPinnedNext.addEventListener('click', () => {
    if (!activeThreadId) return;
    const list = getVisiblePinnedMessages(activeThreadId);
    if (list.length > 0) {
      currentPinnedViewIdx = (currentPinnedViewIdx + 1) % list.length;
      const currentThread = getGroupedThreads().find(t => String(t.threadId) === String(activeThreadId));
      if (currentThread) renderPinnedMessageBar(currentThread);
    }
  });
}

// ============================================================
// 16. TÍNH NĂNG ƯU TIÊN 2: MENU CHUỘT PHẢI HỘI THOẠI (CONV CONTEXT MENU)
// ============================================================
let ctxConvCurrentThread = null;

function showConvContextMenu(e, thread) {
  if (!convContextMenu) return;
  ctxConvCurrentThread = thread;

  const isPinned = pinnedThreadIds.has(String(thread.threadId));
  const isMuted = mutedThreadIds.has(String(thread.threadId));

  if (ctxConvPinLabel) {
    ctxConvPinLabel.textContent = isPinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại lên đầu';
  }
  if (ctxConvMuteLabel) {
    ctxConvMuteLabel.textContent = isMuted ? 'Bật lại thông báo' : 'Tắt thông báo (Im lặng)';
  }
  if (ctxConvMuteIcon) {
    ctxConvMuteIcon.textContent = isMuted ? '🔔' : '🔕';
  }

  // Định vị Menu chuột phải
  convContextMenu.style.display = 'block';
  const menuWidth = 200;
  const menuHeight = convContextMenu.offsetHeight || 180;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth) posX = window.innerWidth - menuWidth - 10;
  if (posY + menuHeight > window.innerHeight) posY = window.innerHeight - menuHeight - 10;

  convContextMenu.style.left = `${Math.max(10, posX)}px`;
  convContextMenu.style.top = `${Math.max(10, posY)}px`;
}

function hideConvContextMenu() {
  if (convContextMenu) {
    convContextMenu.style.display = 'none';
  }
  ctxConvCurrentThread = null;
}

// Click ra ngoài để ẩn Menu chuột phải hội thoại
document.addEventListener('click', (e) => {
  if (convContextMenu && convContextMenu.style.display !== 'none') {
    if (!convContextMenu.contains(e.target)) {
      hideConvContextMenu();
    }
  }
});

if (conversationList) {
  conversationList.addEventListener('scroll', hideConvContextMenu, { passive: true });
}

// 1. Ghim / Bỏ ghim hội thoại
if (ctxConvPin) {
  ctxConvPin.addEventListener('click', async () => {
    if (ctxConvCurrentThread) {
      const thread = ctxConvCurrentThread;
      const isPinned = pinnedThreadIds.has(String(thread.threadId));
      const nextPinned = !isPinned;
      hideConvContextMenu();
      try {
        const result = await window.electronAPI.setPinnedConversation(thread.threadId, nextPinned, thread.isGroup);
        if (!result?.success) throw new Error(result?.error || 'Zalo từ chối cập nhật');
        if (nextPinned) pinnedThreadIds.add(String(thread.threadId));
        else pinnedThreadIds.delete(String(thread.threadId));
        showToast(nextPinned ? `Đã ghim "${thread.senderName}" lên đầu danh sách`
          : `Đã bỏ ghim "${thread.senderName}"`, 'success');
        renderDashboardFeed();
      } catch (error) {
        showToast(`Không thể đổi trạng thái ghim: ${error.message}`, 'error');
      }
    }
    hideConvContextMenu();
  });
}

// 2. Tắt / Bật thông báo
if (ctxConvMute) {
  ctxConvMute.addEventListener('click', async () => {
    if (ctxConvCurrentThread) {
      const thread = ctxConvCurrentThread;
      const isMuted = mutedThreadIds.has(String(thread.threadId));
      const nextMuted = !isMuted;
      if (nextMuted) {
        mutedThreadIds.add(String(thread.threadId));
        showToast(`Đã tắt thông báo "${thread.senderName}".`, 'info');
      } else {
        mutedThreadIds.delete(String(thread.threadId));
        showToast(`Đã bật lại thông báo cho "${thread.senderName}".`, 'success');
      }
      if (window.electronAPI && window.electronAPI.setThreadMute) {
        try {
          await window.electronAPI.setThreadMute(thread.threadId, nextMuted, thread.isGroup, -1);
        } catch (err) {}
      }
      renderDashboardFeed();
    }
    hideConvContextMenu();
  });
}

// 3. Đánh dấu là chưa đọc (Mark as Unread)
if (ctxConvUnread) {
  ctxConvUnread.addEventListener('click', () => {
    if (ctxConvCurrentThread) {
      const thread = ctxConvCurrentThread;
      try {
        const raw = accountStorage.getItem('nhitzalo_read_thread_timestamps');
        const map = raw ? JSON.parse(raw) : {};
        // Xóa thời điểm đã xem để khôi phục lại badge chưa đọc
        delete map[String(thread.threadId)];
        accountStorage.setItem('nhitzalo_read_thread_timestamps', JSON.stringify(map));
        showToast(`Đã đánh dấu "${thread.senderName}" là chưa đọc`, 'success');
        renderDashboardFeed();
      } catch (err) {}
    }
    hideConvContextMenu();
  });
}

// 4. Xóa lịch sử cuộc trò chuyện trên máy tính
if (ctxConvClear) {
  ctxConvClear.addEventListener('click', () => {
    if (ctxConvCurrentThread) {
      const thread = ctxConvCurrentThread;
      if (confirm(`Bạn có chắc muốn xóa sạch tin nhắn lưu trữ của "${thread.senderName}" trên máy tính không?`)) {
        messagesHistory = messagesHistory.filter(m => String(m.threadId) !== String(thread.threadId));
        showToast(`Đã xóa sạch lịch sử "${thread.senderName}" trên máy tính.`, 'info');
        renderDashboardFeed();
      }
    }
    hideConvContextMenu();
  });
}

// ============================================================
// 17. TÍNH NĂNG ƯU TIÊN 2: KÉO - THẢ TỆP TIN & HÌNH ẢNH (DRAG & DROP)
// ============================================================
if (chatMain && dragDropOverlay) {
  let dragCounter = 0;

  chatMain.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      dragDropOverlay.style.display = 'flex';
    }
  });

  chatMain.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  chatMain.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragDropOverlay.style.display = 'none';
      dragCounter = 0;
    }
  });

  chatMain.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDropOverlay.style.display = 'none';
    dragCounter = 0;

    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.path) {
        selectedAttachment = file.path;
        if (chatAttachPreview && attachPreviewName) {
          attachPreviewName.textContent = file.name;
          chatAttachPreview.style.display = 'flex';
        }
        showToast(`Đã nhận tệp: "${file.name}". Bấm phím Gửi để chuyển đi.`, 'info');
        if (chatReplyInput) chatReplyInput.focus();
      }
    }
  });
}

// ============================================================
// 18. TÍNH NĂNG ƯU TIÊN 2: DÁN ẢNH CHỤP MÀN HÌNH TỪ CLIPBOARD (PASTE CTRL+V)
// ============================================================
document.addEventListener('paste', async (e) => {
  // Chỉ kích hoạt khi đang ở tab Tin nhắn và đã chọn một cuộc trò chuyện
  if (currentTab !== 'tab-messages' || !activeThreadId) return;

  const items = e.clipboardData ? e.clipboardData.items : null;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type && item.type.indexOf('image') !== -1) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = reader.result;
          if (window.electronAPI && window.electronAPI.saveClipboardImage) {
            try {
              const savedPath = await window.electronAPI.saveClipboardImage(base64Data);
              if (savedPath) {
                selectedAttachment = savedPath;
                if (chatAttachPreview && attachPreviewName) {
                  attachPreviewName.textContent = '🖼️ Ảnh chụp màn hình vừa dán';
                  chatAttachPreview.style.display = 'flex';
                }
                showToast('Đã đính kèm ảnh chụp màn hình từ Clipboard! Bấm gửi để gửi đi.', 'success');
                if (chatReplyInput) chatReplyInput.focus();
              }
            } catch (err) {
              showToast('Lỗi lưu ảnh clipboard: ' + err.message, 'error');
            }
          }
        };
        reader.readAsDataURL(blob);
      }
      break;
    }
  }
});

// ============================================================
// 19. TÍNH NĂNG ƯU TIÊN 3: BÌNH CHỌN NHÓM (GROUP POLL)
// ============================================================
let pollOptionsList = ['Đồng ý', 'Không đồng ý'];

function parsePollContent(text) {
  if (typeof text !== 'string') return { question: 'Bình chọn', options: [] };
  const lines = text.split('\n');
  const qLine = lines[0].replace(/^\[Bình chọn:\s*|\]$/g, '').trim();
  const opts = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('-') || l.startsWith('•')) {
      opts.push({ text: l.replace(/^[-•]\s*/, ''), votes: 0, voters: [] });
    }
  }
  return {
    question: qLine || 'Bình chọn',
    options: opts.length > 0 ? opts : [{ text: 'Đồng ý', votes: 0 }, { text: 'Không đồng ý', votes: 0 }],
    isAnonymous: false
  };
}

function parseReminderContent(text) {
  if (typeof text !== 'string') return { title: 'Nhắc hẹn', timeStr: '' };
  const lines = text.split('\n');
  const title = lines[0].replace(/^\[Nhắc hẹn:\s*|\]$/g, '').trim();
  const time = lines[1] ? lines[1].replace(/^(Thời gian|Lúc):\s*/i, '').trim() : '';
  return {
    title: title || 'Nhắc hẹn',
    timeStr: time,
    emoji: '⏰'
  };
}

function openPollModal() {
  if (!pollModalOverlay) return;
  pollOptionsList = ['Đồng ý', 'Không đồng ý'];
  if (pollQuestionInput) pollQuestionInput.value = '';
  if (pollMultiChoice) pollMultiChoice.checked = false;
  if (pollAnonymous) pollAnonymous.checked = false;

  renderPollOptionsInputs();
  pollModalOverlay.style.display = 'flex';
  if (pollQuestionInput) pollQuestionInput.focus();
}

function closePollModal() {
  if (pollModalOverlay) pollModalOverlay.style.display = 'none';
}

function renderPollOptionsInputs() {
  if (!pollOptionsContainer) return;
  pollOptionsContainer.innerHTML = '';

  pollOptionsList.forEach((optText, idx) => {
    const row = document.createElement('div');
    row.className = 'poll-option-input-row';
    row.innerHTML = `
      <input type="text" class="form-input-poll opt-input" data-idx="${idx}" placeholder="Phương án ${idx + 1}" value="${escapeHTML(optText)}">
      ${pollOptionsList.length > 2 ? `<button class="btn-remove-option" data-idx="${idx}" title="Xóa phương án">✕</button>` : ''}
    `;

    const input = row.querySelector('.opt-input');
    input.addEventListener('input', (e) => {
      pollOptionsList[idx] = e.target.value;
    });

    const btnRemove = row.querySelector('.btn-remove-option');
    if (btnRemove) {
      btnRemove.addEventListener('click', () => {
        pollOptionsList.splice(idx, 1);
        renderPollOptionsInputs();
      });
    }

    pollOptionsContainer.appendChild(row);
  });
}

if (btnAddPollOption) {
  btnAddPollOption.addEventListener('click', () => {
    if (pollOptionsList.length >= 10) {
      showToast('Tối đa 10 phương án bình chọn', 'info');
      return;
    }
    pollOptionsList.push('');
    renderPollOptionsInputs();
    const allInputs = pollOptionsContainer.querySelectorAll('.opt-input');
    if (allInputs.length > 0) allInputs[allInputs.length - 1].focus();
  });
}

if (btnToggleGroupPoll) {
  btnToggleGroupPoll.addEventListener('click', openPollModal);
}
if (btnClosePollModal) {
  btnClosePollModal.addEventListener('click', closePollModal);
}
if (btnCancelPoll) {
  btnCancelPoll.addEventListener('click', closePollModal);
}

if (btnConfirmPoll) {
  btnConfirmPoll.addEventListener('click', async () => {
    if (!activeThreadId) return;
    const question = (pollQuestionInput ? pollQuestionInput.value : '').trim();
    if (!question) {
      showToast('Vui lòng nhập câu hỏi bình chọn', 'error');
      if (pollQuestionInput) pollQuestionInput.focus();
      return;
    }

    const validOptions = pollOptionsList.map(o => o.trim()).filter(Boolean);
    if (validOptions.length < 2) {
      showToast('Vui lòng điền ít nhất 2 phương án lựa chọn', 'error');
      return;
    }

    btnConfirmPoll.disabled = true;
    btnConfirmPoll.textContent = 'Đang tạo...';

    const isMulti = pollMultiChoice ? pollMultiChoice.checked : false;
    const isAnon = pollAnonymous ? pollAnonymous.checked : false;

    try {
      if (!window.electronAPI?.createGroupPoll) throw new Error('API tạo bình chọn không khả dụng');
      const result = await window.electronAPI.createGroupPoll(activeThreadId, {
        question,
        options: validOptions,
        allowMultiChoices: isMulti,
        allowAddNewOption: true,
        isAnonymous: isAnon
      });
      if (result?.success === false) throw new Error(result.error || 'Tạo bình chọn thất bại');

      // Tạo message cục bộ hiển thị ngay trong chat
      const pollMsg = {
        id: 'poll_' + Date.now(),
        senderName: 'Bạn (Tôi)',
        senderId: 'me',
        threadId: activeThreadId,
        content: `[Bình chọn: ${question}]\n` + validOptions.map(o => `- ${o}`).join('\n'),
        isGroup: true,
        isSelf: true,
        isPoll: true,
        pollData: {
          id: 'poll_data_' + Date.now(),
          question: question,
          options: validOptions.map(o => ({ text: o, votes: 0, voters: [] })),
          isAnonymous: isAnon,
          allowMultiChoices: isMulti
        },
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };

      addMessageToDashboard(pollMsg, false);
      conversationToolsCache.delete(String(activeThreadId));
      showToast('Đã tạo bình chọn thành công!', 'success');
      closePollModal();
    } catch (err) {
      showToast('Lỗi tạo bình chọn: ' + err.message, 'error');
    } finally {
      btnConfirmPoll.disabled = false;
      btnConfirmPoll.textContent = 'Tạo bình chọn';
    }
  });
}

// Bắt sự kiện vote trực tiếp trên thẻ Poll Card trong chat
if (chatMessagesScroll) {
  chatMessagesScroll.addEventListener('click', (e) => {
    const optItem = e.target.closest('.poll-option-item');
    if (!optItem) return;

    const pollCard = optItem.closest('.chat-poll-card');
    if (!pollCard) return;

    const pollId = pollCard.getAttribute('data-poll-id');
    const optIdx = parseInt(optItem.getAttribute('data-opt-idx'), 10);

    const targetMsg = messagesHistory.find(m => String(m.id) === String(pollId));
    if (targetMsg && targetMsg.pollData) {
      const poll = targetMsg.pollData;
      const targetOpt = poll.options[optIdx];
      if (!targetOpt) return;

      if (!targetOpt.voters) targetOpt.voters = [];
      const alreadyVoted = targetOpt.voters.includes('me');

      if (alreadyVoted) {
        targetOpt.voters = targetOpt.voters.filter(v => v !== 'me');
        targetOpt.votes = Math.max(0, (targetOpt.votes || 1) - 1);
        showToast(`Đã hủy vote cho "${targetOpt.text}"`, 'info');
      } else {
        if (!poll.allowMultiChoices) {
          poll.options.forEach(o => {
            if (o.voters && o.voters.includes('me')) {
              o.voters = o.voters.filter(v => v !== 'me');
              o.votes = Math.max(0, (o.votes || 1) - 1);
            }
          });
        }
        targetOpt.voters.push('me');
        targetOpt.votes = (targetOpt.votes || 0) + 1;
        showToast(`Đã vote cho "${targetOpt.text}"`, 'success');
      }
      renderActiveChatThread();
    }
  });
}

// ============================================================
// 20. TÍNH NĂNG ƯU TIÊN 3: NHẮC HẸN (REMINDER)
// ============================================================
let selectedReminderEmoji = '⏰';

function openReminderModal() {
  if (!reminderModalOverlay) return;
  if (reminderTitleInput) reminderTitleInput.value = '';
  if (reminderTimeInput) {
    const now = new Date(Date.now() + 3600000); // Mặc định 1 tiếng sau
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    reminderTimeInput.value = now.toISOString().slice(0, 16);
  }
  selectedReminderEmoji = '⏰';
  const emojiBtns = reminderModalOverlay.querySelectorAll('.reminder-emoji-pick');
  emojiBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-emoji') === '⏰'));

  reminderModalOverlay.style.display = 'flex';
  if (reminderTitleInput) reminderTitleInput.focus();
}

function closeReminderModal() {
  if (reminderModalOverlay) reminderModalOverlay.style.display = 'none';
}

if (btnToggleGroupReminder) {
  btnToggleGroupReminder.addEventListener('click', openReminderModal);
}
if (btnCloseReminderModal) {
  btnCloseReminderModal.addEventListener('click', closeReminderModal);
}
if (btnCancelReminder) {
  btnCancelReminder.addEventListener('click', closeReminderModal);
}

// Chọn emoji nhắc hẹn
if (reminderModalOverlay) {
  const emojiPicks = reminderModalOverlay.querySelectorAll('.reminder-emoji-pick');
  emojiPicks.forEach(pick => {
    pick.addEventListener('click', () => {
      emojiPicks.forEach(p => p.classList.remove('active'));
      pick.classList.add('active');
      selectedReminderEmoji = pick.getAttribute('data-emoji') || '⏰';
    });
  });
}

if (btnConfirmReminder) {
  btnConfirmReminder.addEventListener('click', async () => {
    if (!activeThreadId) return;
    const title = (reminderTitleInput ? reminderTitleInput.value : '').trim();
    if (!title) {
      showToast('Vui lòng nhập nội dung nhắc hẹn', 'error');
      if (reminderTitleInput) reminderTitleInput.focus();
      return;
    }

    const timeVal = reminderTimeInput ? reminderTimeInput.value : '';
    const dateObj = timeVal ? new Date(timeVal) : new Date(Date.now() + 3600000);
    const timeStr = dateObj.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

    btnConfirmReminder.disabled = true;
    btnConfirmReminder.textContent = 'Đang tạo...';

    const threads = getGroupedThreads();
    const currentThread = threads.find(t => String(t.threadId) === String(activeThreadId));
    const isGroup = currentThread ? currentThread.isGroup : false;

    try {
      if (!window.electronAPI?.createGroupReminder) throw new Error('API tạo nhắc hẹn không khả dụng');
      const result = await window.electronAPI.createGroupReminder(activeThreadId, {
        title,
        startTime: dateObj.getTime(),
        emoji: selectedReminderEmoji
      }, isGroup);
      if (result?.success === false) throw new Error(result.error || 'Tạo nhắc hẹn thất bại');

      // Thêm message Reminder vào timeline chat
      const reminderMsg = {
        id: 'rem_' + Date.now(),
        senderName: 'Bạn (Tôi)',
        senderId: 'me',
        threadId: activeThreadId,
        content: `[Nhắc hẹn: ${title}]\nThời gian: ${timeStr}`,
        isGroup: isGroup,
        isSelf: true,
        isReminder: true,
        reminderData: {
          id: 'rem_data_' + Date.now(),
          title: title,
          timeStr: timeStr,
          timestamp: dateObj.getTime(),
          emoji: selectedReminderEmoji
        },
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };

      addMessageToDashboard(reminderMsg, false);
      conversationToolsCache.delete(String(activeThreadId));
      showToast('Đã tạo lịch nhắc hẹn thành công!', 'success');
      closeReminderModal();
    } catch (err) {
      showToast('Lỗi tạo nhắc hẹn: ' + err.message, 'error');
    } finally {
      btnConfirmReminder.disabled = false;
      btnConfirmReminder.textContent = 'Tạo nhắc hẹn';
    }
  });
}

// ============================================================
// 21. TÍNH NĂNG ƯU TIÊN 3: HỒ SƠ BẠN BÈ (PROFILE CARD MODAL)
// ============================================================
let profileCurrentTarget = null;

function openProfileModal(target) {
  if (!profileModalOverlay || !target) return;
  profileCurrentTarget = target;

  const uId = String(target.userId || target.threadId || target.id || '');
  const dName = target.name || target.displayName || target.zaloName || target.senderName || 'Bạn bè Zalo';

  // Tra cứu thêm trong danh bạ bạn bè nếu có
  const friend = (allFriendsList || []).find(f => String(f.userId) === uId);
  const avatar = target.avatar || (friend ? friend.avatar : '');
  const zaloName = (friend && friend.zaloName) || dName;

  if (profileDisplayName) profileDisplayName.textContent = dName;
  if (profileSubTitle) profileSubTitle.textContent = friend ? 'Bạn trong danh bạ Zalo' : 'Thành viên Zalo';
  if (profileUid) profileUid.textContent = uId || 'Không rõ';
  if (profileZaloName) profileZaloName.textContent = zaloName;

  if (profileAvatarBox) {
    const initial = (dName || 'Z')[0].toUpperCase();
    profileAvatarBox.innerHTML = avatar
      ? `<img src="${escapeHTML(avatar)}" alt="${escapeHTML(dName)}" onerror="this.style.display='none';">`
      : `<span style="font-size: 26px;">${escapeHTML(initial)}</span>`;
  }

  profileModalOverlay.style.display = 'flex';
}

function closeProfileModal() {
  if (profileModalOverlay) profileModalOverlay.style.display = 'none';
  profileCurrentTarget = null;
}

// Tìm kiếm trong toàn bộ lịch sử đã lưu trên máy
const globalSearchOverlay = document.getElementById('global-search-overlay');
const globalSearchInput = document.getElementById('global-search-input');
const globalSearchResults = document.getElementById('global-search-results');
const globalSearchStatus = document.getElementById('global-search-status');
const globalSearchMore = document.getElementById('global-search-more');
let globalSearchOffset = 0;
let globalSearchRequest = 0;
let globalSearchTimer = null;
let globalSearchReturnFocus = null;

function closeGlobalSearch() {
  if (globalSearchOverlay) globalSearchOverlay.style.display = 'none';
  globalSearchRequest++;
  globalSearchReturnFocus?.focus();
}

async function runGlobalSearch(reset = true) {
  if (!globalSearchInput || !globalSearchResults || !globalSearchStatus) return;
  const query = globalSearchInput.value.trim();
  if (reset) {
    globalSearchOffset = 0;
    globalSearchResults.replaceChildren();
  }
  globalSearchMore.style.display = 'none';
  if (query.length < 2) {
    globalSearchStatus.textContent = 'Nhập ít nhất 2 ký tự để tìm trong tin nhắn đã lưu.';
    return;
  }
  const requestId = ++globalSearchRequest;
  globalSearchStatus.textContent = 'Đang tìm...';
  try {
    const page = await window.electronAPI.searchHistoryMessages(query, 50, globalSearchOffset);
    if (requestId !== globalSearchRequest || query !== globalSearchInput.value.trim()) return;
    for (const message of page) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'global-search-result';
      const name = document.createElement('strong');
      name.textContent = message.threadName || message.senderName || 'Hội thoại';
      const when = document.createElement('small');
      when.textContent = message.timestamp ? new Date(message.timestamp).toLocaleString('vi-VN') : '';
      const snippet = document.createElement('span');
      snippet.textContent = message.content || '[Tin nhắn không có văn bản]';
      item.append(name, when, snippet);
      item.addEventListener('click', () => {
        closeGlobalSearch();
        document.querySelector('[data-tab="tab-messages"]')?.click();
        activeThreadId = String(message.threadId);
        messageFocusId = String(message.id);
        addMessageToDashboard(message, true);
        renderDashboardFeed();
        markThreadAsRead(activeThreadId);
        requestAnimationFrame(() => scrollToAndHighlightMessage(message.id));
      });
      globalSearchResults.appendChild(item);
    }
    globalSearchOffset += page.length;
    globalSearchStatus.textContent = globalSearchOffset
      ? `Đã tìm thấy ${globalSearchOffset} tin nhắn${page.length === 50 ? ' (còn kết quả)' : ''}.`
      : 'Không có kết quả. Hãy thử từ khóa khác.';
    globalSearchMore.style.display = page.length === 50 ? 'block' : 'none';
  } catch (error) {
    globalSearchStatus.textContent = `Không thể tìm kiếm: ${error.message}`;
  }
}

document.getElementById('btn-search-all')?.addEventListener('click', (event) => {
  globalSearchReturnFocus = event.currentTarget;
  globalSearchOverlay.style.display = 'flex';
  globalSearchInput.focus();
});
document.getElementById('global-search-close')?.addEventListener('click', closeGlobalSearch);
globalSearchOverlay?.addEventListener('click', event => {
  if (event.target === globalSearchOverlay) closeGlobalSearch();
});
globalSearchInput?.addEventListener('input', () => {
  clearTimeout(globalSearchTimer);
  globalSearchRequest++;
  globalSearchTimer = setTimeout(() => runGlobalSearch(true), 250);
});
globalSearchMore?.addEventListener('click', () => runGlobalSearch(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && globalSearchOverlay?.style.display === 'flex') closeGlobalSearch();
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    document.getElementById('btn-search-all')?.click();
  }
});

if (btnCloseProfileModal) {
  btnCloseProfileModal.addEventListener('click', closeProfileModal);
}
if (profileModalOverlay) {
  profileModalOverlay.addEventListener('click', (e) => {
    if (e.target === profileModalOverlay) closeProfileModal();
  });
}

if (btnProfileCopyId) {
  btnProfileCopyId.addEventListener('click', () => {
    if (profileCurrentTarget) {
      const uId = String(profileCurrentTarget.userId || profileCurrentTarget.threadId || '');
      navigator.clipboard.writeText(uId).then(() => {
        showToast('Đã sao chép mã Zalo UID vào Clipboard!', 'success');
      });
    }
  });
}

if (btnProfileSendMsg) {
  btnProfileSendMsg.addEventListener('click', () => {
    if (profileCurrentTarget) {
      const uId = String(profileCurrentTarget.userId || profileCurrentTarget.threadId || '');
      if (uId) {
        activeThreadId = uId;
        renderDashboardFeed();
        markThreadAsRead(activeThreadId);
        closeProfileModal();
        showToast(`Đã mở cuộc trò chuyện với "${profileDisplayName.textContent}"`, 'info');
      }
    }
  });
}
