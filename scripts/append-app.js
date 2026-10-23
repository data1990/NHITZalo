const fs = require('fs');
const path = require('path');

const additionalCode = `
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

// 3. Danh sách Sticker Zalo nổi tiếng (CDN Zalo chuẩn)
const zaloStickers = [
  // Mèo Ami bụng bự (catId 10047)
  { id: 16715, cateId: 10047, name: 'Ami Vui vẻ' },
  { id: 16716, cateId: 10047, name: 'Ami Thả tim' },
  { id: 16717, cateId: 10047, name: 'Ami Hôn' },
  { id: 16718, cateId: 10047, name: 'Ami Cười toe' },
  { id: 16719, cateId: 10047, name: 'Ami Khóc' },
  { id: 16720, cateId: 10047, name: 'Ami Dỗi hờn' },
  { id: 16721, cateId: 10047, name: 'Ami Vẫy tay' },
  { id: 16722, cateId: 10047, name: 'Ami Chúc ngủ ngon' },
  { id: 16723, cateId: 10047, name: 'Ami OK' },
  // Bé Heo Zalo (catId 10123)
  { id: 20695, cateId: 10123, name: 'Heo Cười' },
  { id: 20696, cateId: 10123, name: 'Heo Bắn tim' },
  { id: 20697, cateId: 10123, name: 'Heo Vỗ tay' },
  { id: 20698, cateId: 10123, name: 'Heo Nháy mắt' },
  { id: 20699, cateId: 10123, name: 'Heo Suy tư' },
  // Quỳnh Aka (catId 10012)
  { id: 10050, cateId: 10012, name: 'Quỳnh Aka Chào' },
  { id: 10051, cateId: 10012, name: 'Quỳnh Aka Cười' },
  { id: 10052, cateId: 10012, name: 'Quỳnh Aka Dỗi' },
  { id: 10053, cateId: 10012, name: 'Quỳnh Aka Like' }
];

function initEmojiAndStickers() {
  // Render Emoji Grid
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

  // Render Sticker Grid
  if (stickerGrid) {
    stickerGrid.innerHTML = '';
    zaloStickers.forEach(stk => {
      const btn = document.createElement('button');
      btn.className = 'sticker-grid-btn';
      const imgUrl = \`https://api.zaloapp.com/api/emoticon/sticker/webpc?eid=\${stk.id}&size=130\`;
      btn.innerHTML = \`
        <img src="\${imgUrl}" alt="\${stk.name}" loading="lazy">
        <span class="sticker-label">\${stk.name}</span>
      \`;
      btn.title = 'Gửi sticker ' + stk.name;
      btn.addEventListener('click', async () => {
        if (!activeThreadId) {
          showToast('Vui lòng chọn một cuộc trò chuyện để gửi sticker', 'info');
          return;
        }
        const threads = getGroupedThreads();
        const currentThread = threads.find(t => t.threadId === activeThreadId);
        const isGroup = currentThread ? currentThread.isGroup : false;

        try {
          showToast('Đang gửi sticker Zalo...', 'info');
          if (window.electronAPI && window.electronAPI.sendSticker) {
            const res = await window.electronAPI.sendSticker(activeThreadId, stk, isGroup);
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

  // Chuyển Tab giữa Emoji và Sticker
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
      } else {
        if (emojiPanel) emojiPanel.classList.remove('active');
        if (stickerPanel) stickerPanel.classList.add('active');
      }
    });
  });

  // Bật/Tắt Emoji Picker
  if (btnToggleEmoji && emojiPickerContainer) {
    btnToggleEmoji.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = emojiPickerContainer.style.display === 'flex';
      emojiPickerContainer.style.display = isVisible ? 'none' : 'flex';
    });
  }

  // Đóng Emoji Picker khi click nút đóng hoặc click ra ngoài
  if (btnCloseEmojiPicker && emojiPickerContainer) {
    btnCloseEmojiPicker.addEventListener('click', () => {
      emojiPickerContainer.style.display = 'none';
    });
  }
  document.addEventListener('click', (e) => {
    if (emojiPickerContainer && emojiPickerContainer.style.display === 'flex') {
      if (!emojiPickerContainer.contains(e.target) && !btnToggleEmoji.contains(e.target)) {
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
          const fileName = filePath.split(/[\\\\/]/).pop();
          if (chatAttachPreview && attachPreviewName) {
            attachPreviewName.textContent = '🖼️ ' + fileName;
            chatAttachPreview.style.display = 'flex';
          }
          showToast('🔒 Tệp hình ảnh đã chọn. Sẵn sàng gửi an toàn tới Zalo Mr Hoàng.', 'info');
          if (chatReplyInput) chatReplyInput.focus();
        }
      }
    });
  }
}

// Khởi chạy hệ thống Emoji & Sticker
initEmojiAndStickers();
`;

const appJsPath = path.join(__dirname, '..', 'src', 'renderer', 'dashboard', 'app.js');
fs.appendFileSync(appJsPath, additionalCode, 'utf8');
console.log('Successfully appended Emoji, Sticker & Lightbox logic to app.js');
