const fs = require('fs');
const path = require('path');

const css = `
/* Cải tiến thanh tìm kiếm & danh mục Sticker */
.emoji-picker-container {
  width: 440px !important;
  height: 420px !important;
}

.sticker-toolbar-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(30, 41, 59, 0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sticker-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 5px 10px;
}

.sticker-search-box svg {
  color: #94A3B8;
  flex-shrink: 0;
}

.sticker-search-box input {
  background: transparent;
  border: none;
  outline: none;
  color: #F8FAFC;
  font-size: 12.5px;
  width: 100%;
}

.sticker-search-box input::placeholder {
  color: #64748B;
}

.sticker-cat-pills {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.sticker-cat-pills::-webkit-scrollbar {
  height: 3px;
}

.stk-cat-pill {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94A3B8;
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.stk-cat-pill:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #F8FAFC;
}

.stk-cat-pill.active {
  background: #0068FF;
  border-color: #0068FF;
  color: #fff;
  font-weight: 600;
}

.sticker-grid {
  grid-template-columns: repeat(4, 1fr) !important;
  gap: 10px !important;
}

.sticker-grid-btn {
  padding: 6px !important;
  background: rgba(255, 255, 255, 0.04) !important;
}

.sticker-grid-btn img {
  width: 82px !important;
  height: 82px !important;
  object-fit: contain !important;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sticker-grid-btn:hover img {
  transform: scale(1.15);
}
`;

fs.appendFileSync(path.join(__dirname, '../src/renderer/dashboard/styles.css'), css, 'utf8');
console.log('Appended sticker toolbar css!');
