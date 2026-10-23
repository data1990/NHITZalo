const fs = require('fs');
const path = require('path');

const newStyles = `
/* ============================================================
   BỘ STYLE HIỂN THỊ HÌNH ẢNH, STICKER, ICON CHAT CHUẨN ZALO
   ============================================================ */

/* 1. Hình ảnh trong tin nhắn */
.chat-msg-img-wrap {
  position: relative;
  display: inline-block;
  max-width: 340px;
  max-height: 420px;
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
  margin-top: 4px;
}

.chat-msg-img-wrap:hover {
  transform: translateY(-2px) scale(1.015);
  box-shadow: 0 8px 24px rgba(0, 104, 255, 0.25);
  border-color: rgba(56, 189, 248, 0.4);
}

.chat-msg-img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 340px;
  max-height: 400px;
  object-fit: cover;
  border-radius: 13px;
  transition: opacity 0.3s ease;
}

.chat-img-overlay-btn {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
  backdrop-filter: blur(4px);
}

.chat-msg-img-wrap:hover .chat-img-overlay-btn {
  opacity: 1;
}

/* 2. Video Player mini trong tin nhắn */
.chat-msg-video {
  max-width: 340px;
  max-height: 280px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #000;
  outline: none;
  margin-top: 4px;
}

/* 3. Sticker Zalo (hiển thị nổi bật, nền trong suốt) */
.chat-msg-sticker-wrap {
  display: inline-block;
  padding: 4px 0;
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  margin-top: 4px;
}

.chat-msg-sticker {
  display: block;
  width: 130px;
  height: 130px;
  object-fit: contain;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  filter: drop-shadow(0 4px 10px rgba(0,0,0,0.25));
}

.chat-msg-sticker:hover {
  transform: scale(1.1);
}

/* 4. Thanh công cụ gửi chat (Icon chat, photo, folder) */
.chat-input-bar-wrap {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.btn-chat-tool {
  background: transparent;
  border: none;
  color: #94A3B8;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;
  padding: 0;
}

.btn-chat-tool:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #38BDF8;
  transform: scale(1.08);
}

.tool-icon-svg {
  width: 20px;
  height: 20px;
  object-fit: contain;
  pointer-events: none;
}

/* 5. Cải tiến Reaction Menu bằng SVG Zalo chuẩn */
.reaction-picker-menu {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  border-radius: 24px;
  padding: 4px 8px;
}

.reaction-pick-emoji {
  cursor: pointer;
  padding: 3px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.reaction-pick-emoji:hover {
  transform: scale(1.35) translateY(-3px);
}

.reaction-pick-emoji img {
  width: 24px;
  height: 24px;
  display: block;
}

.reaction-pill img {
  width: 15px;
  height: 15px;
  vertical-align: middle;
  margin-right: 2px;
}

/* 6. Emoji & Sticker Drawer Popup */
.emoji-picker-container {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 12px;
  width: 370px;
  height: 320px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 1px 1px rgba(56, 189, 248, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 100;
  animation: slideUpFade 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUpFade {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.emoji-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(30, 41, 59, 0.4);
}

.emoji-picker-tabs {
  display: flex;
  gap: 6px;
}

.emoji-tab-btn {
  background: transparent;
  border: none;
  color: #94A3B8;
  font-size: 13px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.emoji-tab-btn:hover {
  color: #F8FAFC;
  background: rgba(255, 255, 255, 0.06);
}

.emoji-tab-btn.active {
  color: #38BDF8;
  background: rgba(56, 189, 248, 0.14);
}

.btn-close-emoji {
  background: transparent;
  border: none;
  color: #64748B;
  font-size: 15px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.btn-close-emoji:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #EF4444;
}

.emoji-picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.emoji-tab-panel {
  display: none;
}

.emoji-tab-panel.active {
  display: block;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.emoji-grid-btn {
  background: transparent;
  border: none;
  font-size: 24px;
  padding: 6px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.emoji-grid-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.22);
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 4px;
}

.sticker-grid-btn {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sticker-grid-btn:hover {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.35);
  transform: translateY(-2px) scale(1.04);
}

.sticker-grid-btn img {
  width: 76px;
  height: 76px;
  object-fit: contain;
}

.sticker-label {
  font-size: 11px;
  color: #94A3B8;
  margin-top: 4px;
  font-weight: 500;
}

/* 7. Lightbox Modal Xem Ảnh Toàn Màn Hình */
.image-lightbox-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.lightbox-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(10, 15, 26, 0.92);
  backdrop-filter: blur(12px);
}

.lightbox-content {
  position: relative;
  z-index: 10;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lightbox-toolbar {
  position: absolute;
  top: -46px;
  right: 0;
  display: flex;
  gap: 10px;
}

.lightbox-tool-btn {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #F8FAFC;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.lightbox-tool-btn:hover {
  background: rgba(56, 189, 248, 0.25);
  color: #38BDF8;
}

.lightbox-tool-btn.close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  color: #EF4444;
}

.lightbox-img-wrap {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #000;
}

.lightbox-img-wrap img {
  display: block;
  max-width: 85vw;
  max-height: 80vh;
  object-fit: contain;
}
`;

const cssPath = path.join(__dirname, '..', 'src', 'renderer', 'dashboard', 'styles.css');
fs.appendFileSync(cssPath, newStyles, 'utf8');
console.log('Successfully appended styles to styles.css');
