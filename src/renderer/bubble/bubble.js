// Web Audio Notification Chime (Chime âm thanh thông báo du dương)
function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.12); // A5

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6

    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.25);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (e) {
    console.warn('Không thể phát âm thanh thông báo:', e);
  }
}

// Bảng màu gradient hiện đại, sang trọng cho avatar fallback
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #0084FF 0%, #0052CC 100%)',
  'linear-gradient(135deg, #10B981 0%, #047857 100%)',
  'linear-gradient(135deg, #F59E0B 0%, #B45309 100%)',
  'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
  'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)',
  'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)',
  'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)',
  'linear-gradient(135deg, #14B8A6 0%, #0F766E 100%)'
];

function getGradientByName(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash += name.charCodeAt(i);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

// Lấy 1-2 chữ cái đầu viết tắt hiển thị avatar đẹp mắt
function getInitials(name) {
  if (!name) return 'Z';
  const clean = name.trim().replace(/^Nhóm\s+/i, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.substring(0, Math.min(2, clean.length)).toUpperCase();
}

// Lấy icon file chính hãng Zalo theo định dạng phần mở rộng
function getBubbleFileIcon(fileName = '') {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '../assets/zalo-icons/File_Excel_48_Colored.svg';
  if (['doc', 'docx'].includes(ext)) return '../assets/zalo-icons/File_Word_48_Colored.svg';
  if (['pdf'].includes(ext)) return '../assets/zalo-icons/File_Pdf_48_Colored.svg';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '../assets/zalo-icons/File_Zip_48_Colored.svg';
  return '../assets/zalo-icons/File_Attachment_48_Colored.svg';
}

// Định dạng dung lượng tệp tin (bytes -> KB, MB, GB)
function formatBubbleFileSize(bytes) {
  if (!bytes || isNaN(bytes) || Number(bytes) <= 0) return '';
  const num = Number(bytes);
  if (num < 1024) return num + ' B';
  if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
  if (num < 1024 * 1024 * 1024) return (num / (1024 * 1024)).toFixed(1) + ' MB';
  return (num / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ==========================================
// STATE MANAGEMENT (Quản lý các Thread Chat)
// ==========================================
// Map: threadId -> { threadId, senderName, avatar, isGroup, isMuted, unreadCount, lastTime, messages: [] }
const threadsMap = new Map();
const accountParams = new URLSearchParams(window.location.search);
const accountStorage = createAccountStorage(window.localStorage,
  accountParams.get('accountId'), accountParams.get('legacy') === '1');
const threadVisibility = createBubbleThreadVisibility(accountStorage);
let activeThreadId = null;
let isBubbleExpanded = false;

// Kéo thả
let isDragging = false;
let startX = 0;
let startY = 0;
let dragDistance = 0;

// DOM Elements
const bubbleContainer = document.getElementById('bubble-container');
const collapsedHead = document.getElementById('collapsed-head');
const expandedCard = document.getElementById('expanded-card');
const unreadBadge = document.getElementById('unread-badge');
const chatheadsTrack = document.getElementById('chatheads-track');
const cardSenderName = document.getElementById('card-sender-name');
const cardSenderType = document.getElementById('card-sender-type');
const threadStatusText = document.getElementById('thread-status-text');
const messagesList = document.getElementById('messages-list');
const bubbleCopyMenu = document.getElementById('bubble-copy-menu');
let bubbleCopyText = '';
const emptyState = document.getElementById('empty-state');
const replyInput = document.getElementById('reply-input');
const btnSendReply = document.getElementById('btn-send-reply');
const btnCollapse = document.getElementById('btn-collapse');
const btnDashboard = document.getElementById('btn-dashboard');
const btnSyncBubble = document.getElementById('btn-sync-bubble');
const bubbleHeaderDraggable = document.getElementById('bubble-header-draggable');

// Elements cho Avatar trên icon tròn
const brandLogoIcon = document.getElementById('brand-logo-icon');
const senderAvatar = document.getElementById('sender-avatar');
const senderInitials = document.getElementById('sender-initials');

// Elements cho Khung xem trước tin nhắn (Preview Pill) khi ẩn / thu gọn
const bubblePreviewPill = document.getElementById('bubble-preview-pill');
const previewAvatarBox = document.getElementById('preview-avatar-box');
const previewAvatarImg = document.getElementById('preview-avatar-img');
const previewAvatarLetter = document.getElementById('preview-avatar-letter');
const previewSenderName = document.getElementById('preview-sender-name');
const previewSnippetText = document.getElementById('preview-snippet-text');
const previewCloseBtn = document.getElementById('preview-close-btn');

// ==========================================
// HÀM TIỆN ÍCH CHO XEM TRƯỚC TIN NHẮN (PREVIEW)
// ==========================================

// Lấy đoạn trích nội dung tin nhắn ngắn gọn hiển thị trên preview
function getMessageSnippet(msg) {
  if (!msg) return 'Tin nhắn mới';
  if (msg.isUndo || msg.isRevoked || msg.isRecalled) return '🚫 Tin nhắn đã được thu hồi';
  if (window.VoiceMessage.getVoicePresentation(msg).isVoice) return '🎤 [Tin nhắn thoại]';
  if (msg.isPhoto) return '📷 [Hình ảnh]';
  if (msg.isVideo) return '🎥 [Video]';
  if (msg.isSticker) return '✨ [Nhãn dán Sticker]';
  if (msg.isFile) return `📎 [Tệp: ${msg.fileName || 'Tài liệu'}]`;
  if (typeof msg.content === 'string') {
    if (msg.content.startsWith('[Tài liệu:')) return `📎 ${msg.content.replace(/^\[Tài liệu:\s*|\]$/g, '')}`;
    if (msg.content === '[Hình ảnh]' || msg.content === '[Video]' || msg.content === '[Nhãn dán Sticker]') return msg.content;
    return msg.content;
  }
  return 'Tin nhắn mới';
}

// Cập nhật avatar trên icon bong bóng tròn
function updateCollapsedHeadAvatar(threadOrMsg) {
  if (!threadOrMsg) return;
  const name = threadOrMsg.senderName || threadOrMsg.threadName || 'Zalo';
  const avatarUrl = threadOrMsg.avatar || threadOrMsg.threadAvatar || '';

  if (avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))) {
    if (senderAvatar) {
      senderAvatar.src = avatarUrl;
      senderAvatar.classList.remove('hidden');
      senderAvatar.onerror = () => {
        senderAvatar.classList.add('hidden');
        if (senderInitials) {
          senderInitials.textContent = getInitials(name);
          senderInitials.style.background = getGradientByName(name);
          senderInitials.classList.remove('hidden');
        } else if (brandLogoIcon) {
          brandLogoIcon.classList.remove('hidden');
        }
      };
    }
    if (brandLogoIcon) brandLogoIcon.classList.add('hidden');
    if (senderInitials) senderInitials.classList.add('hidden');
  } else {
    if (senderAvatar) senderAvatar.classList.add('hidden');
    if (brandLogoIcon) brandLogoIcon.classList.add('hidden');
    if (senderInitials) {
      senderInitials.textContent = getInitials(name);
      senderInitials.style.background = getGradientByName(name);
      senderInitials.classList.remove('hidden');
    }
  }
}

// Khôi phục avatar mặc định của bong bóng tròn
function resetCollapsedHeadAvatar() {
  if (brandLogoIcon) brandLogoIcon.classList.remove('hidden');
  if (senderAvatar) senderAvatar.classList.add('hidden');
  if (senderInitials) senderInitials.classList.add('hidden');
}

// Hiển thị khung xem trước tin nhắn (Preview Pill)
function showBubblePreview(message, align = 'right') {
  if (!message || isBubbleExpanded) return;
  if (!bubblePreviewPill) return;

  const senderTitle = (message.isGroup && message.threadName && message.threadName !== message.senderName)
    ? `${message.threadName} • ${message.senderName || 'Thành viên'}`
    : (message.senderName || message.threadName || 'Bạn bè Zalo');

  if (previewSenderName) previewSenderName.textContent = senderTitle;
  if (previewSnippetText) previewSnippetText.textContent = getMessageSnippet(message);

  const avatarUrl = message.avatar || message.threadAvatar || '';
  const initials = getInitials(message.senderName || message.threadName);
  const grad = getGradientByName(message.senderName || message.threadName);

  if (avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))) {
    if (previewAvatarImg) {
      previewAvatarImg.src = avatarUrl;
      previewAvatarImg.classList.remove('hidden');
      previewAvatarImg.onerror = () => {
        previewAvatarImg.classList.add('hidden');
        if (previewAvatarLetter) {
          previewAvatarLetter.textContent = initials;
          previewAvatarLetter.style.background = grad;
          previewAvatarLetter.classList.remove('hidden');
        }
      };
    }
    if (previewAvatarLetter) previewAvatarLetter.classList.add('hidden');
  } else {
    if (previewAvatarImg) previewAvatarImg.classList.add('hidden');
    if (previewAvatarLetter) {
      previewAvatarLetter.textContent = initials;
      previewAvatarLetter.style.background = grad;
      previewAvatarLetter.classList.remove('hidden');
    }
  }

  bubbleContainer.classList.remove('align-left', 'align-right');
  bubbleContainer.classList.add(align === 'left' ? 'align-left' : 'align-right');
  bubbleContainer.classList.add('previewing');
  bubblePreviewPill.classList.remove('hidden');

  // Đồng thời cập nhật avatar trên icon bong bóng tròn
  updateCollapsedHeadAvatar(message);
}

// Ẩn khung xem trước tin nhắn
function hideBubblePreview() {
  if (bubblePreviewPill) bubblePreviewPill.classList.add('hidden');
  if (bubbleContainer) bubbleContainer.classList.remove('previewing');
}

// Click vào Preview Pill để mở ngay cuộc trò chuyện
if (bubblePreviewPill) {
  bubblePreviewPill.addEventListener('click', (e) => {
    if (e.target.closest('#preview-close-btn')) return;
    hideBubblePreview();
    if (window.electronAPI && window.electronAPI.bubbleExpand) {
      window.electronAPI.bubbleExpand();
    }
  });
}

// Nút (X) đóng nhanh xem trước tin nhắn
if (previewCloseBtn) {
  previewCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBubblePreview();
    if (window.electronAPI && window.electronAPI.bubbleHidePreview) {
      window.electronAPI.bubbleHidePreview();
    }
  });
}

// ==========================================
// 1. KÉO THẢ (DRAG & DROP) BUBBLE TRÒN & HEADER
// ==========================================
function setupDraggable(element, isCollapsedHead = false) {
  if (!element) return;
  element.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.chathead-item')) return;

    // Nếu đang hiện preview pill thì ẩn ngay để kéo mượt mà
    if (bubblePreviewPill && !bubblePreviewPill.classList.contains('hidden')) {
      hideBubblePreview();
      if (window.electronAPI && window.electronAPI.bubbleHidePreview) {
        window.electronAPI.bubbleHidePreview();
      }
    }

    isDragging = true;
    startX = e.screenX;
    startY = e.screenY;
    dragDistance = 0;

    const onMouseMove = (moveEvent) => {
      if (!isDragging) return;
      const deltaX = moveEvent.screenX - startX;
      const deltaY = moveEvent.screenY - startY;
      dragDistance += Math.abs(deltaX) + Math.abs(deltaY);

      startX = moveEvent.screenX;
      startY = moveEvent.screenY;

      if (window.electronAPI && window.electronAPI.bubbleDragMove) {
        window.electronAPI.bubbleDragMove(deltaX, deltaY);
      }
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        if (window.electronAPI && window.electronAPI.bubbleDragEnd) {
          window.electronAPI.bubbleDragEnd();
        }

        // Click mở rộng nếu di chuyển < 6px
        if (isCollapsedHead && dragDistance < 6) {
          if (window.electronAPI && window.electronAPI.bubbleExpand) {
            window.electronAPI.bubbleExpand();
          }
        }
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

setupDraggable(collapsedHead, true);
setupDraggable(bubbleHeaderDraggable, false);

// ==========================================
// 2. CHUYỂN ĐỔI TRẠNG THÁI THU GỌN / MỞ RỘNG
// ==========================================
if (window.electronAPI && window.electronAPI.onBubbleStateChanged) {
  window.electronAPI.onBubbleStateChanged(({ isExpanded }) => {
    isBubbleExpanded = !!isExpanded;
    if (isExpanded) {
      hideBubblePreview();
      bubbleContainer.classList.remove('collapsed');
      bubbleContainer.classList.add('expanded');
      collapsedHead.classList.remove('pulsing');

      // Khi mở ra, xóa unread cho thread đang xem
      if (activeThreadId && threadsMap.has(activeThreadId)) {
        threadsMap.get(activeThreadId).unreadCount = 0;
        if (window.electronAPI && window.electronAPI.markThreadRead) {
          window.electronAPI.markThreadRead(activeThreadId);
        }
      }
      updateTotalUnreadBadge();
      renderChatHeads();

      setTimeout(() => {
        messagesList.scrollTop = messagesList.scrollHeight;
        replyInput.focus();
      }, 60);
    } else {
      bubbleContainer.classList.remove('expanded');
      bubbleContainer.classList.add('collapsed');
      hideBubblePreview();

      // Nếu không còn tin chưa đọc thì khôi phục logo
      let totalUnread = 0;
      for (const t of threadsMap.values()) totalUnread += (t.unreadCount || 0);
      if (totalUnread === 0) {
        resetCollapsedHeadAvatar();
      }
    }
  });
}

// Lắng nghe lệnh hiển thị/ẩn Preview từ Main Process
if (window.electronAPI && window.electronAPI.onBubbleShowPreview) {
  window.electronAPI.onBubbleShowPreview(({ message, align }) => {
    showBubblePreview(message, align);
  });
}

if (window.electronAPI && window.electronAPI.onBubblePreviewHidden) {
  window.electronAPI.onBubblePreviewHidden(() => {
    hideBubblePreview();
  });
}

btnCollapse.addEventListener('click', () => {
  if (window.electronAPI && window.electronAPI.bubbleCollapse) {
    window.electronAPI.bubbleCollapse();
  }
});

btnDashboard.addEventListener('click', () => {
  if (window.electronAPI && window.electronAPI.openDashboard) {
    window.electronAPI.openDashboard();
  }
});

// Nút đồng bộ tin nhắn cũ trên Bubble
if (btnSyncBubble) {
  btnSyncBubble.addEventListener('click', async () => {
    btnSyncBubble.style.transform = 'rotate(360deg)';
    btnSyncBubble.style.transition = 'transform 0.8s ease';
    const oldStatus = threadStatusText.textContent;

    try {
      threadStatusText.textContent = 'Đang đồng bộ...';
      if (window.electronAPI && window.electronAPI.syncOldMessages) {
        const res = await window.electronAPI.syncOldMessages();
        if (res?.requestAccepted) {
          threadStatusText.textContent = 'Đang chờ điện thoại phản hồi';
        } else if (res && res.success && res.completed) {
          threadStatusText.textContent = res.added > 0 ? `+${res.added} tin mới` : 'Đã cập nhật';
        } else {
          threadStatusText.textContent = res?.error || 'Đồng bộ chưa hoàn tất';
        }
      }
    } catch (e) {
      threadStatusText.textContent = 'Lỗi đồng bộ';
    } finally {
      setTimeout(() => {
        btnSyncBubble.style.transform = '';
        btnSyncBubble.style.transition = '';
      }, 800);
      setTimeout(() => {
        threadStatusText.textContent = oldStatus;
      }, 3000);
    }
  });
}

// ==========================================
// 3. XỬ LÝ DỮ LIỆU & GOM NHÓM TIN NHẮN THEO THREAD
// ==========================================
function processIncomingMessage(msg, isNew = false) {
  if (!msg || msg.isConversation || (msg.id && String(msg.id).startsWith('conv_'))) return null;

  // QUY TẮC BẤT BIẾN: CHỈ CÓ TIN NHẮN NÀO BẬT THÔNG BÁO MỚI HIỆN LÊN BONG BÓNG!
  // Nếu hội thoại bị tắt thông báo (isMuted), loại bỏ hoàn toàn khỏi bong bóng chat:
  if (msg.isMuted) {
    const tId = String(msg.threadId || msg.senderId || (msg.isGroup ? msg.groupId : ''));
    if (tId && threadsMap.has(tId)) {
      threadsMap.delete(tId);
      if (activeThreadId === tId) {
        activeThreadId = null;
      }
    }
    return null;
  }

  const tId = String(msg.threadId || msg.senderId || (msg.isGroup ? msg.groupId : 'unknown'));
  if (!tId || tId === 'unknown') return null;

  // XÁC ĐỊNH TÊN VÀ AVATAR CHUẨN CỦA CUỘC TRÒ CHUYỆN (THREAD):
  // 1. Tên hội thoại:
  let resolvedThreadName = msg.threadName;
  if (!resolvedThreadName || resolvedThreadName === 'Bạn (Tôi)') {
    resolvedThreadName = (!msg.isSelf && msg.senderName && msg.senderName !== 'Bạn (Tôi)') 
      ? msg.senderName 
      : (msg.isGroup ? 'Nhóm Zalo' : 'Bạn bè Zalo');
  }

  // 2. Avatar hội thoại (Ưu tiên avatar của Nhóm hoặc Bạn bè):
  // TUYỆT ĐỐI KHÔNG lấy avatar của Bạn (Tôi) (khi msg.isSelf === true) gán cho Thread của người khác!
  let resolvedThreadAvatar = msg.threadAvatar || '';
  if (!resolvedThreadAvatar && !msg.isSelf && msg.avatar) {
    resolvedThreadAvatar = msg.avatar;
  }

  let thread = threadsMap.get(tId);
  if (!thread) {
    thread = {
      threadId: tId,
      senderName: resolvedThreadName,
      avatar: resolvedThreadAvatar,
      isGroup: Boolean(msg.isGroup),
      isMuted: Boolean(msg.isMuted),
      unreadCount: 0,
      lastTime: msg.timestamp || Date.now(),
      messages: []
    };
    threadsMap.set(tId, thread);
  } else {
    // Cập nhật thông tin tốt hơn (không ghi đè bằng tên hoặc avatar của Bạn (Tôi))
    if (resolvedThreadName && resolvedThreadName !== 'Bạn (Tôi)' && resolvedThreadName !== 'Bạn bè Zalo') {
      thread.senderName = resolvedThreadName;
    }
    if (resolvedThreadAvatar) {
      thread.avatar = resolvedThreadAvatar;
    }
    if (typeof msg.isGroup === 'boolean') thread.isGroup = msg.isGroup;
    if (msg.timestamp) thread.lastTime = Math.max(thread.lastTime, msg.timestamp);
  }

  // Kiểm tra trùng lặp tin nhắn thông minh (bao gồm cả tin nhắn vừa gửi đi của chính mình)
  const targetId = String(msg.id || '');
  const targetCli = String(msg.cliMsgId || '');

  const existingIndex = thread.messages.findIndex(m => {
    // 1. Khớp theo ID hoặc cliMsgId
    if (targetId && (String(m.id) === targetId || String(m.cliMsgId) === targetId)) return true;
    if (targetCli && (String(m.cliMsgId) === targetCli || String(m.id) === targetCli)) return true;

    // 2. Chống x2 tin nhắn của chính mình vừa gửi (cùng nội dung, cùng là isSelf và trong vòng 20 giây)
    if (m.isSelf && msg.isSelf && m.content === msg.content) {
      const t1 = Number(m.timestamp) || 0;
      const t2 = Number(msg.timestamp) || 0;
      if (Math.abs(t1 - t2) < 20000) return true;
    }
    return false;
  });

  if (existingIndex !== -1) {
    // Nếu tin đã có là tin tạm self_ và tin mới đến là tin server với id thật -> Cập nhật thông tin chuẩn
    const existing = thread.messages[existingIndex];
    if (String(existing.id).startsWith('self_') && targetId && !targetId.startsWith('self_')) {
      existing.id = targetId;
      if (targetCli) existing.cliMsgId = targetCli;
      if (msg.time) existing.time = msg.time;
      if (msg.timestamp) existing.timestamp = msg.timestamp;
    }
  } else {
    thread.messages.push(msg);
    // Sắp xếp theo timestamp tăng dần (cũ đến mới để hiển thị cuộc trò chuyện từ trên xuống)
    thread.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Nếu tin nhắn mới và không đang xem thread này hoặc bubble đang thu gọn:
    if (isNew && (!isBubbleExpanded || activeThreadId !== tId)) {
      thread.unreadCount++;
    } else if (isNew && isBubbleExpanded && activeThreadId === tId) {
      if (window.electronAPI && window.electronAPI.markThreadRead) {
        window.electronAPI.markThreadRead(tId);
      }
    }
  }

  // Nếu chưa có activeThreadId thì gán thread này làm active
  if (!activeThreadId && !threadVisibility.isClosed(tId)) {
    activeThreadId = tId;
  }

  return thread;
}

// Cập nhật tổng số badge chưa đọc
function updateTotalUnreadBadge() {
  let total = 0;
  for (const t of threadVisibility.visible([...threadsMap.values()])) {
    total += (t.unreadCount || 0);
  }

  if (total > 0) {
    unreadBadge.textContent = total > 99 ? '99+' : total;
    unreadBadge.classList.remove('hidden');
  } else {
    unreadBadge.classList.add('hidden');
    collapsedHead.classList.remove('pulsing');
    resetCollapsedHeadAvatar();
  }
}

// ==========================================
// 4. HIỂN THỊ DẢI ICON CHAT HEADS (PHÍA TRÊN)
// ==========================================
function renderChatHeads() {
  chatheadsTrack.innerHTML = '';

  const threadsArray = threadVisibility.visible([...threadsMap.values()]);
  // Sắp xếp các thread: người có tin nhắn gần nhất lên đầu
  threadsArray.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

  if (threadsArray.length === 0) {
    const defaultHead = document.createElement('div');
    defaultHead.className = 'chathead-item active';
    defaultHead.innerHTML = `
      <div class="chathead-avatar-box">
        <img src="../../assets/logo.png" class="chathead-avatar-img" alt="Zalo">
      </div>
    `;
    chatheadsTrack.appendChild(defaultHead);
    return;
  }

  threadsArray.forEach(thread => {
    const head = document.createElement('div');
    head.className = 'chathead-item';
    if (thread.threadId === activeThreadId) {
      head.classList.add('active');
    }
    head.setAttribute('title', thread.senderName || 'Hội thoại Zalo');
    head.dataset.threadId = thread.threadId;

    const initials = getInitials(thread.senderName);
    const bgGradient = getGradientByName(thread.senderName);

    let avatarHTML = '';
    // Nếu có avatar URL ảnh thật (http/https)
    if (thread.avatar && (thread.avatar.startsWith('http://') || thread.avatar.startsWith('https://'))) {
      avatarHTML = `<img src="${escapeHTML(thread.avatar)}" class="chathead-avatar-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'chathead-avatar-letter\\' style=\\'background:${bgGradient}\\'>${initials}</div>';" alt="Avatar">`;
    } else {
      // Fallback chữ cái viết tắt với nền Gradient nổi bật
      avatarHTML = `<div class="chathead-avatar-letter" style="background: ${bgGradient};">${initials}</div>`;
    }

    const groupDotHTML = thread.isGroup ? `<div class="chathead-group-dot" title="Nhóm">G</div>` : '';
    const unreadHTML = thread.unreadCount > 0 ? `<span class="chathead-unread-badge">${thread.unreadCount > 9 ? '9+' : thread.unreadCount}</span>` : '';

    head.innerHTML = `
      <div class="chathead-avatar-box">
        ${avatarHTML}
      </div>
      ${groupDotHTML}
      ${unreadHTML}
      <button type="button" class="chathead-close" title="Đóng ${escapeHTML(thread.senderName || 'hội thoại')}" aria-label="Đóng ${escapeHTML(thread.senderName || 'hội thoại')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    `;

    head.querySelector('.chathead-close').addEventListener('click', event => {
      event.stopPropagation();
      closeChatHead(thread.threadId);
    });

    // Click vào icon người nhắn tin để chuyển hội thoại
    head.addEventListener('click', () => {
      switchActiveThread(thread.threadId);
    });

    chatheadsTrack.appendChild(head);
  });
}

function closeChatHead(threadId) {
  const thread = threadsMap.get(threadId);
  if (!thread) return;
  threadVisibility.close(threadId);
  thread.unreadCount = 0;

  if (activeThreadId === threadId) {
    const remaining = threadVisibility.visible([...threadsMap.values()])
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
    if (remaining.length) {
      switchActiveThread(remaining[0].threadId);
      updateCollapsedHeadAvatar(remaining[0]);
    } else {
      activeThreadId = null;
      cardSenderName.textContent = 'Bong bóng Zalo';
      cardSenderType.textContent = 'Chờ tin nhắn mới';
      threadStatusText.textContent = '';
      replyInput.placeholder = 'Chờ tin nhắn mới...';
      messagesList.innerHTML = '';
      emptyState.style.display = 'flex';
      resetCollapsedHeadAvatar();
    }
  }

  updateTotalUnreadBadge();
  renderChatHeads();
}

// Chuyển sang hội thoại của người được chọn
function switchActiveThread(threadId, markAsRead = null) {
  if (!threadsMap.has(threadId) || threadVisibility.isClosed(threadId)) return;
  activeThreadId = threadId;

  const thread = threadsMap.get(threadId);
  // Chỉ đánh dấu đã đọc nếu cửa sổ chat đang mở (isBubbleExpanded) hoặc được chỉ định tường minh
  const shouldMarkRead = (markAsRead !== null) ? markAsRead : isBubbleExpanded;
  if (shouldMarkRead) {
    thread.unreadCount = 0;
    if (window.electronAPI && window.electronAPI.markThreadRead) {
      window.electronAPI.markThreadRead(threadId);
    }
  }
  updateTotalUnreadBadge();

  // Cập nhật lại thanh Chat Heads
  renderChatHeads();

  // Cập nhật Header thông tin hội thoại
  const senderTitle = thread.senderName || 'Bạn bè Zalo';
  cardSenderName.textContent = senderTitle;
  cardSenderType.textContent = thread.isGroup ? 'Nhóm' : 'Cá nhân';
  cardSenderType.className = `badge-type ${thread.isGroup ? 'group' : ''}`;
  threadStatusText.textContent = 'Đang hoạt động';

  // Cập nhật placeholder khung nhập
  replyInput.placeholder = `Trả lời ${thread.senderName || 'Zalo'}...`;

  // Render các tin nhắn của thread này
  renderConversationMessages(thread.messages || []);

  // Nếu tin nhắn trong thread ít hơn 10 tin, gọi lấy thêm lịch sử chi tiết
  if (thread.messages.length < 50 && window.electronAPI?.getThreadHistory) {
    window.electronAPI.getThreadHistory(thread.threadId, 50, 0)
      .then(local => local?.length ? local : window.electronAPI.fetchThreadMessages(thread.threadId, thread.isGroup))
      .then(fetchedMsgs => {
        if (Array.isArray(fetchedMsgs) && fetchedMsgs.length > 0) {
          fetchedMsgs.forEach(m => processIncomingMessage(m, false));
          if (activeThreadId === thread.threadId) {
            renderConversationMessages(thread.messages || []);
          }
        }
      })
      .catch(err => console.warn('Lỗi nạp sâu tin nhắn:', err));
  }
}

// ==========================================
// 5. HIỂN THỊ NỘI DUNG TIN NHẮN (CHAT BUBBLE BODY)
// ==========================================
function renderConversationMessages(msgList) {
  if (!msgList || msgList.length === 0) {
    emptyState.style.display = 'flex';
    messagesList.querySelectorAll('.chat-bubble-row').forEach(el => el.remove());
    return;
  }
  emptyState.style.display = 'none';

  // Xóa danh sách cũ
  messagesList.innerHTML = '';

  const activeThread = threadsMap.get(activeThreadId);
  const isGroupChat = activeThread ? activeThread.isGroup : false;

  msgList.forEach(msg => {
    const isSelf = Boolean(
      msg.isSelf ||
      msg.senderName === 'Bạn (Tôi)' ||
      msg.senderId === 'self'
    );

    const isRevokedMsg = Boolean(
      msg.isUndo ||
      msg.isRevoked ||
      msg.isRecalled ||
      msg.content === 'Tin nhắn đã được thu hồi' ||
      msg.content === '[Tin nhắn đã bị xóa]' ||
      (typeof msg.content === 'string' && (
        msg.content.includes('Tin nhắn đã được thu hồi') ||
        msg.content.includes('Tin nhắn đã bị thu hồi') ||
        msg.content.includes('đã thu hồi một tin nhắn')
      ))
    );

    let contentHTML = '';
    const voice = !isRevokedMsg ? window.VoiceMessage.getVoicePresentation(msg) : { isVoice: false };
    if (isRevokedMsg) {
      contentHTML = `<span style="font-style: italic; color: #94A3B8; display: inline-flex; align-items: center; gap: 4px;">🚫 Tin nhắn đã được thu hồi</span>`;
    } else if (voice.isVoice) {
      contentHTML = `<div class="bubble-voice">
        <span aria-hidden="true">🎤</span>
        <div><strong>Tin nhắn thoại${voice.duration ? ` • ${escapeHTML(voice.duration)}` : ''}</strong>
          ${voice.url ? `<audio controls preload="none" src="${escapeHTML(voice.url)}" aria-label="Phát tin nhắn thoại"></audio>`
            : '<small>Chưa có tệp âm thanh trong lịch sử đã đồng bộ</small>'}
        </div>
      </div>`;
    } else if (msg.isSticker || msg.stickerUrl) {
      const sUrl = msg.stickerUrl || 'https://api.zaloapp.com/api/emoticon/sticker/webpc?eid=16715&size=130';
      contentHTML = `<img src="${escapeHTML(sUrl)}" class="bubble-sticker" alt="Sticker">`;
    } else if (msg.isPhoto || (typeof msg.content === 'string' && (msg.content.match(/^https?:\/\/[^\s]+(\.(jpg|jpeg|png|webp|gif)|\/jpg\/|\/png\/)/i) || msg.content.includes('.zdn.vn/')))) {
      const pUrl = msg.photoUrl || msg.thumbUrl || msg.content;
      const photoCaption = window.PhotoCaption.getPhotoCaption(msg);
      contentHTML = `<div class="bubble-photo-message"><img src="${escapeHTML(pUrl)}" class="bubble-image" alt="Ảnh">
        ${photoCaption ? `<div class="bubble-photo-caption">${escapeHTML(photoCaption)}</div>` : ''}</div>`;
    } else if (msg.isFile || msg.fileName || (typeof msg.content === 'string' && (msg.content.startsWith('[Tài liệu:') || msg.content.match(/\.(zip|rar|7z|docx?|xlsx?|pdf|pptx?)$/i)))) {
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

      const fExt = (fName.split('.').pop() || 'FILE').toUpperCase();
      const fSizeStr = formatBubbleFileSize(msg.fileSize);
      const fUrl = msg.fileUrl || '';

      contentHTML = `
        <div class="bubble-file-card" data-file-url="${escapeHTML(fUrl)}" data-file-name="${escapeHTML(fName)}">
          <div class="bubble-file-icon-box">
            <img src="${getBubbleFileIcon(fName)}" class="bubble-file-img" alt="${escapeHTML(fExt)}" onerror="this.src='../assets/zalo-icons/File_Attachment_48_Colored.svg';">
          </div>
          <div class="bubble-file-info">
            <span class="bubble-file-name" title="${escapeHTML(fName)}">${escapeHTML(fName)}</span>
            <span class="bubble-file-meta">${escapeHTML(fExt)}${fSizeStr ? ` • ${escapeHTML(fSizeStr)}` : ''}</span>
          </div>
          ${fUrl ? `
            <button class="bubble-file-dl-btn" data-url="${escapeHTML(fUrl)}" data-name="${escapeHTML(fName)}" title="Tải về máy">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          ` : ''}
        </div>
      `;
    } else {
      contentHTML = `<div class="bubble-text">${escapeHTML(msg.content)}</div>`;
    }

    const row = document.createElement('div');
    row.className = `chat-bubble-row ${isSelf ? 'self' : 'other'}`;

    // Avatar nhỏ của thành viên trong nhóm (bên cạnh bong bóng)
    let authorAvatarHTML = '';
    if (!isSelf && isGroupChat) {
      const memberInitial = (msg.senderName || 'Z').trim()[0].toUpperCase();
      const memberGrad = getGradientByName(msg.senderName);
      if (msg.avatar && (msg.avatar.startsWith('http://') || msg.avatar.startsWith('https://'))) {
        authorAvatarHTML = `<img src="${escapeHTML(msg.avatar)}" class="bubble-member-avatar" onerror="this.onerror=null; this.outerHTML='<div class=\\'bubble-member-avatar letter\\' style=\\'background:${memberGrad}\\'>${memberInitial}</div>';" alt="">`;
      } else {
        authorAvatarHTML = `<div class="bubble-member-avatar letter" style="background:${memberGrad}">${memberInitial}</div>`;
      }
    }

    let senderTitleHTML = '';
    if (!isSelf && isGroupChat && msg.senderName) {
      senderTitleHTML = `<div class="bubble-sender-title">${escapeHTML(msg.senderName)}</div>`;
    }

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
      ? `<div class="bubble-reactions">
          ${msg.reactions.map(r => {
            const rawIcon = String(r.icon || '❤️');
            const svgPath = reactionSvgMap[rawIcon] || reactionSvgMap[reactionEmojiMap[rawIcon]];
            const displayEmoji = reactionEmojiMap[rawIcon] || rawIcon;
            const iconContent = svgPath
              ? `<img src="${svgPath}" alt="${escapeHTML(displayEmoji)}" class="reaction-pill-svg" style="width:13px;height:13px;">`
              : escapeHTML(displayEmoji);
            return `<span class="bubble-reaction-pill" title="${escapeHTML(r.senderName || '')}">${iconContent}</span>`;
          }).join('')}
         </div>`
      : '';

    const timeStr = msg.time || (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '');

    row.innerHTML = `
      ${senderTitleHTML}
      <div class="bubble-message-wrap">
        ${authorAvatarHTML}
        <div class="bubble-box">
          ${contentHTML}
          ${reactionsHtml}
          <div class="bubble-footer">
            <span class="bubble-time">${timeStr}</span>
          </div>
          ${!isRevokedMsg ? `
            <div class="bubble-reaction-action">
              <button type="button" class="bubble-reaction-trigger" title="Bấm để thả Tim, rê chuột để chọn cảm xúc" aria-label="Thả Tim hoặc chọn cảm xúc">
                <img src="../assets/zalo-icons/Heart_24_emoji.svg" alt="">
              </button>
              <div class="bubble-reaction-picker" aria-label="Chọn cảm xúc">
                <button type="button" class="bubble-reaction-pick" data-emoji="❤️" title="Tim"><img src="../assets/zalo-icons/Heart_24_emoji.svg" alt="Tim"></button>
                <button type="button" class="bubble-reaction-pick" data-emoji="👍" title="Thích"><img src="../assets/zalo-icons/Like_24_emoji.svg" alt="Thích"></button>
                <button type="button" class="bubble-reaction-pick" data-emoji="😂" title="Haha"><img src="../assets/zalo-icons/Smile_24_emoji.svg" alt="Haha"></button>
                <button type="button" class="bubble-reaction-pick" data-emoji="😮" title="Wow"><img src="../assets/zalo-icons/Surprised_24_emoji.svg" alt="Wow"></button>
                <button type="button" class="bubble-reaction-pick" data-emoji="😢" title="Buồn"><img src="../assets/zalo-icons/Cry_24_emoji.svg" alt="Buồn"></button>
                <button type="button" class="bubble-reaction-pick" data-emoji="😡" title="Phẫn nộ"><img src="../assets/zalo-icons/Rage_24_emoji.svg" alt="Phẫn nộ"></button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    const sendReaction = async (emoji, button) => {
      if (!window.electronAPI?.sendReaction || button.disabled) return;
      button.disabled = true;
      try {
        const result = await window.electronAPI.sendReaction(activeThread.threadId, msg.id, msg.cliMsgId, emoji, activeThread.isGroup);
        if (!result?.success) throw new Error(result?.error || 'Zalo từ chối thả cảm xúc');
      } catch (error) {
        alert('Không thể thả cảm xúc: ' + error.message);
      } finally {
        button.disabled = false;
      }
    };

    const reactionTrigger = row.querySelector('.bubble-reaction-trigger');
    reactionTrigger?.addEventListener('click', event => {
      event.stopPropagation();
      sendReaction('❤️', reactionTrigger);
    });
    row.querySelectorAll('.bubble-reaction-pick').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        sendReaction(button.dataset.emoji, button);
      });
    });

    messagesList.appendChild(row);
  });

  // Tự động cuộn xuống tin nhắn mới nhất
  messagesList.scrollTop = messagesList.scrollHeight;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================
// 6. KHỞI TẠO & LẮNG NGHE SỰ KIỆN TỪ MAIN PROCESS
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.getBubbleStartupMessages) {
    try {
      const savedMessages = await window.electronAPI.getBubbleStartupMessages();
      if (Array.isArray(savedMessages) && savedMessages.length > 0) {
        // Chỉ nạp các tin nhắn của hội thoại BẬT THÔNG BÁO (!m.isMuted)
        const unmutedMsgs = savedMessages.filter(m => !m.isMuted);
        unmutedMsgs.forEach(msg => processIncomingMessage(msg, false));

        // Bổ sung tra cứu avatar/tên từ danh bạ nhóm và bạn bè để đảm bảo hiển thị đúng 100%
        if (window.electronAPI.getGroupsList) {
          try {
            const groups = await window.electronAPI.getGroupsList();
            if (Array.isArray(groups)) {
              groups.forEach(g => {
                const gid = String(g.groupId || '');
                const thread = threadsMap.get(gid) || threadsMap.get('g_' + gid);
                if (thread) {
                  if (g.name) thread.senderName = g.name;
                  if (g.avatar) thread.avatar = g.avatar;
                }
              });
            }
          } catch (e) {}
        }

        if (window.electronAPI.getFriendsList) {
          try {
            const friends = await window.electronAPI.getFriendsList();
            if (Array.isArray(friends)) {
              friends.forEach(f => {
                const fid = String(f.userId || '');
                const thread = threadsMap.get(fid);
                if (thread && !thread.isGroup) {
                  if (f.displayName || f.zaloName) thread.senderName = f.displayName || f.zaloName;
                  if (f.avatar) thread.avatar = f.avatar;
                }
              });
            }
          } catch (e) {}
        }

        // Chọn thread có tin nhắn mới nhất
        const threadsArray = threadVisibility.visible([...threadsMap.values()]);
        if (threadsArray.length > 0) {
          threadsArray.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
          switchActiveThread(threadsArray[0].threadId, false);
          updateCollapsedHeadAvatar(threadsArray[0]);
        } else {
          renderChatHeads();
        }
      } else {
        renderChatHeads();
      }
    } catch (e) {
      console.warn('Lỗi khi nạp tin nhắn cũ cho bubble:', e);
      renderChatHeads();
    }
  }
});

// Lắng nghe tin nhắn mới từ Zalo
if (window.electronAPI && window.electronAPI.onBubbleMessage) {
  window.electronAPI.onBubbleMessage(({ message, isOld, unreadCount, allMessages }) => {
    // CHỈ CÓ TIN NHẮN NÀO BẬT THÔNG BÁO MỚI HIỆN LÊN BONG BÓNG:
    if (message && message.isMuted) return;

    const hadActiveThread = Boolean(activeThreadId);
    const msgThreadId = message
      ? String(message.threadId || message.senderId || (message.isGroup ? message.groupId : 'unknown'))
      : '';
    if (message) threadVisibility.reopenForMessage(msgThreadId, { isOld, isSelf: message.isSelf });

    // Xử lý tin mới trước danh sách lịch sử để số chưa đọc không bị mất vì trùng ID.
    if (message) processIncomingMessage(message, !isOld);

    if (Array.isArray(allMessages)) {
      allMessages.filter(m => !m.isMuted).forEach(m => processIncomingMessage(m, false));
    }

    if (message && !message.isMuted) {
      if (!isOld) {
        playNotificationSound();
        collapsedHead.classList.add('pulsing');
      }

      if (!isBubbleExpanded && !threadVisibility.isClosed(msgThreadId)) {
        // Khi cửa sổ chat đang thu gọn/ẩn: Tự động chuyển activeThread sang người vừa gửi tin mới
        // (chưa xóa unreadCount vì người dùng chưa mở cửa sổ xem chi tiết)
        switchActiveThread(msgThreadId, false);

        const currentThread = threadsMap.get(msgThreadId);
        updateCollapsedHeadAvatar(currentThread || message);

        // Hiển thị khung xem trước tin nhắn nổi bên cạnh bong bóng tròn
        if (!isOld && !message.isSelf) {
          showBubblePreview(message);
        }
      } else if (!threadVisibility.isClosed(msgThreadId)) {
        if (!hadActiveThread) {
          switchActiveThread(msgThreadId);
        } else if (activeThreadId === msgThreadId) {
          const thread = threadsMap.get(activeThreadId);
          if (thread) {
            renderConversationMessages(thread.messages);
          }
        }
      }
    }

    updateTotalUnreadBadge();
    renderChatHeads();
  });
}

// Lắng nghe sự kiện thay đổi tắt/bật thông báo của hội thoại
if (window.electronAPI && window.electronAPI.onThreadMuteChanged) {
  window.electronAPI.onThreadMuteChanged(({ threadId, isMuted }) => {
    const sId = String(threadId);
    if (isMuted) {
      // Khi hội thoại bị tắt thông báo: Lập tức xóa khỏi danh sách Chat Heads bong bóng
      threadsMap.delete(sId);
      threadsMap.delete(sId.replace(/^g_/, ''));
      threadsMap.delete('g_' + sId);

      if (activeThreadId === sId || activeThreadId === sId.replace(/^g_/, '') || activeThreadId === ('g_' + sId)) {
        const remaining = threadVisibility.visible([...threadsMap.values()]);
        if (remaining.length > 0) {
          switchActiveThread(remaining[0].threadId);
        } else {
          activeThreadId = null;
          cardSenderName.textContent = 'Bong bóng Zalo';
          cardSenderType.textContent = 'Chờ tin nhắn';
          messagesList.innerHTML = '';
          emptyState.style.display = 'flex';
          renderChatHeads();
        }
      } else {
        renderChatHeads();
      }
      updateTotalUnreadBadge();
    }
  });
}

// Lắng nghe sự kiện thu hồi tin nhắn
if (window.electronAPI?.onPhotoCaptionUpdated) {
  window.electronAPI.onPhotoCaptionUpdated(({ threadId, msgId, photoCaption }) => {
    const thread = threadsMap.get(String(threadId));
    if (!thread) return;
    let changed = false;
    for (const message of thread.messages) {
      if (String(message.id) !== String(msgId)) continue;
      message.photoCaption = photoCaption;
      changed = true;
    }
    if (changed && String(activeThreadId) === String(threadId)) {
      renderConversationMessages(thread.messages);
    }
  });
}

if (window.electronAPI && window.electronAPI.onMessageUndo) {
  window.electronAPI.onMessageUndo((undoData) => {
    try {
      if (!undoData) return;
      const targetId = String(undoData.msgId || '');
      const targetCli = String(undoData.cliMsgId || '');
      let hasUpdate = false;

      for (const thread of threadsMap.values()) {
        for (const m of thread.messages) {
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
            hasUpdate = true;
          }
        }
      }

      if (hasUpdate && activeThreadId && threadsMap.has(activeThreadId)) {
        renderConversationMessages(threadsMap.get(activeThreadId).messages);
      }
    } catch (e) {
      console.warn('Lỗi xử lý onMessageUndo trong bubble.js:', e);
    }
  });
}

// Lắng nghe sự kiện reaction cập nhật thời gian thực trong Bubble Chat
if (window.electronAPI && window.electronAPI.onMessageReaction) {
  window.electronAPI.onMessageReaction((reactionData) => {
    try {
      if (!reactionData) return;
      const targetId = String(reactionData.msgId || '');
      const targetCli = String(reactionData.cliMsgId || '');
      let hasUpdate = false;

      for (const thread of threadsMap.values()) {
        for (const m of thread.messages) {
          if ((targetId && targetId !== '0' && (String(m.id) === targetId || String(m.msgId) === targetId)) ||
              (targetCli && String(m.cliMsgId) === targetCli)) {
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
            hasUpdate = true;
          }
        }
      }

      if (hasUpdate && activeThreadId && threadsMap.has(activeThreadId)) {
        renderConversationMessages(threadsMap.get(activeThreadId).messages);
      }
    } catch (e) {
      console.warn('Lỗi xử lý onMessageReaction trong bubble.js:', e);
    }
  });
}

// ==========================================
// 7. GỬI TIN NHẮN TRẢ LỜI NHANH (QUICK REPLY)
// ==========================================
let isSendingReply = false;

async function handleSendReply() {
  const content = replyInput.value.trim();
  if (!content) return;

  if (isSendingReply) return;
  isSendingReply = true;

  if (!activeThreadId || !threadsMap.has(activeThreadId)) {
    alert('Vui lòng chọn một người nhắn tin phía trên để trả lời');
    isSendingReply = false;
    return;
  }

  const thread = threadsMap.get(activeThreadId);
  replyInput.disabled = true;
  btnSendReply.disabled = true;

  try {
    if (window.electronAPI && window.electronAPI.sendReply) {
      const res = await window.electronAPI.sendReply(thread.threadId, content, thread.isGroup);
      if (res && res.success) {
        // Dùng object tin nhắn chính thức trả về từ server hoặc fallback
        const sentMsg = res.message || {
          id: 'self_' + Date.now(),
          threadId: thread.threadId,
          isSelf: true,
          senderName: 'Bạn (Tôi)',
          content: content,
          timestamp: Date.now(),
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        };

        // Đưa tin nhắn vào với bộ lọc chống trùng lặp x2 thông minh
        processIncomingMessage(sentMsg, false);
        thread.lastTime = sentMsg.timestamp || Date.now();

        // Render lại danh sách tin nhắn và scroll xuống cuối
        renderConversationMessages(thread.messages);
        replyInput.value = '';
        renderChatHeads();
      } else {
        alert('Gửi tin nhắn thất bại: ' + (res?.error || 'Lỗi không xác định'));
      }
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    replyInput.disabled = false;
    btnSendReply.disabled = false;
    replyInput.focus();
    setTimeout(() => {
      isSendingReply = false;
    }, 300);
  }
}

btnSendReply.addEventListener('click', handleSendReply);
replyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    // Không gửi khi đang gõ gõ bộ gõ tiếng Việt (Unikey/EVKey composition)
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    handleSendReply();
  }
});

// Bắt sự kiện bấm nút tải file trực tiếp trên Bong bóng chat
messagesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.bubble-file-dl-btn');
  if (btn) {
    e.stopPropagation();
    const url = btn.dataset.url;
    const name = btn.dataset.name;
    if (url && window.electronAPI && window.electronAPI.downloadFile) {
      const origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳';
      try {
        await window.electronAPI.downloadFile(url, name, false);
      } catch (err) {
        console.warn('Lỗi tải file trên bubble:', err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
      }
    }
  }
});

messagesList.addEventListener('contextmenu', event => {
  const row = event.target.closest('.chat-bubble-row');
  if (!row) return;
  const selection = window.getSelection();
  const selectedText = selection && row.contains(selection.anchorNode) && row.contains(selection.focusNode)
    ? selection.toString() : '';
  const fullText = row.querySelector('.bubble-text')?.textContent || '';
  bubbleCopyText = selectedText || fullText;
  if (!bubbleCopyText || !bubbleCopyMenu) return;
  event.preventDefault();
  bubbleCopyMenu.textContent = selectedText ? 'Sao chép đoạn đã chọn' : 'Sao chép tin nhắn';
  bubbleCopyMenu.classList.remove('hidden');
  const menuWidth = bubbleCopyMenu.offsetWidth;
  const menuHeight = bubbleCopyMenu.offsetHeight;
  bubbleCopyMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))}px`;
  bubbleCopyMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))}px`;
});

function hideBubbleCopyMenu() {
  bubbleCopyMenu?.classList.add('hidden');
}

bubbleCopyMenu?.addEventListener('click', async event => {
  event.stopPropagation();
  const text = bubbleCopyText;
  hideBubbleCopyMenu();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    alert('Không thể sao chép văn bản: ' + error.message);
  }
});

document.addEventListener('click', event => {
  if (!bubbleCopyMenu?.contains(event.target)) hideBubbleCopyMenu();
});
messagesList.addEventListener('scroll', hideBubbleCopyMenu, { passive: true });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideBubbleCopyMenu();
});

// Lắng nghe sự kiện hội thoại đã được đọc (đồng bộ từ Dashboard hoặc Bubble)
if (window.electronAPI && window.electronAPI.onThreadMarkedAsRead) {
  window.electronAPI.onThreadMarkedAsRead(({ threadId, cleanId }) => {
    const sId = String(threadId || '');
    const cId = String(cleanId || sId.replace(/^g_/, ''));
    const t = threadsMap.get(sId) || threadsMap.get(cId) || threadsMap.get('g_' + cId);
    if (t) {
      t.unreadCount = 0;
      updateTotalUnreadBadge();
      renderChatHeads();
    }
  });
}
