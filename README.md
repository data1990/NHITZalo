# 🚀 NHIT Zalo Bubble Notifier (Ứng dụng Electron)

Ứng dụng desktop xây dựng bằng **Electron** kết hợp cùng thư viện **`zalo-api-final`**, giúp:
1. **Đọc tin nhắn từ Zalo theo thời gian thực (Real-time message listener)**.
2. **Hiển thị tin nhắn dạng bong bóng tròn nổi trên màn hình (Floating Circular Chat Bubble)** tương tự như Facebook Messenger Chat Head.
3. **Bấm vào bong bóng để xem nội dung tin nhắn, tên người gửi, thời gian và trả lời nhanh trực tiếp**.
4. **Bảng điều khiển (Dashboard)** quản lý kết nối, quét mã QR đăng nhập, xem nhật ký tin nhắn và cấu hình tùy chỉnh.

---

## 🌟 Tính Năng Nổi Bật

- 🟢 **Đăng nhập bằng mã QR tiện lợi**: Quét mã QR trực tiếp ngay trên màn hình bằng ứng dụng Zalo trên điện thoại (không cần trích xuất cookie thủ công).
- 💾 **Tự động lưu phiên (Auto Login)**: Tự động lưu session trên máy tính cục bộ để các lần mở ứng dụng tiếp theo tự động kết nối mà không cần quét lại mã QR.
- 🔐 **Nhiều tài khoản trên cùng máy**: Chọn tài khoản khi mở ứng dụng. Mật khẩu là tùy chọn cho từng tài khoản; nút **Tài khoản trên máy này** mở modal để đặt hoặc gỡ mật khẩu và chuyển tài khoản. Mỗi tài khoản có phiên Zalo, tin nhắn, danh bạ, nhóm và cài đặt bong bóng riêng. Mật khẩu chỉ khóa truy cập trong ứng dụng; tệp lịch sử trên ổ đĩa chưa được mã hóa bằng mật khẩu này.
- 🔴 **Bong bóng chat tròn nổi (Floating Bubble)**:
  - Luôn nổi trên các ứng dụng khác (`Always on Top`).
  - Hỗ trợ **kéo thả chuột (Drag & Drop)** đến mọi vị trí trên màn hình. Tự động lưu vị trí người dùng đã chọn.
  - Hiệu ứng phát sóng ánh sáng (**Pulsing Glow**) và **huy hiệu số tin nhắn chưa đọc màu đỏ** khi có tin nhắn mới tới.
  - Tích hợp **âm thanh thông báo Chime du dương** được tổng hợp bằng Web Audio API.
  - Bấm vào bong bóng để mở rộng xem nội dung tin nhắn, avatar, thời gian và trả lời nhanh (**Quick Reply**).
- 📊 **Bảng điều khiển trực quan (Dashboard)**:
  - Xem dòng thời gian tin nhắn Zalo đến theo thời gian thực (Live Stream Feed).
  - Nút **"Thử tin nhắn mẫu"** để test ngay giao diện popup bong bóng tròn mà không cần chờ người nhắn thật.
  - Cấu hình bật/tắt hiển thị bong bóng và nút đặt lại vị trí mặc định.
- 📌 **Khay hệ thống (System Tray Icon)**:
  - Ẩn/Hiện ứng dụng dưới khay Taskbar Windows tiện lợi.

---

## 🛠️ Cài Đặt & Chạy Ứng Dụng

### Yêu cầu:
- **Node.js** (Khuyên dùng v18 hoặc mới hơn).

### Chạy ứng dụng:
Mở PowerShell hoặc Command Prompt tại thư mục dự án và chạy:

```bash
npm start
```
npm install
npm run build:win

### Cập nhật ứng dụng qua GitHub Releases

Bản cài đặt Windows đọc `latest.yml` của release cố định [`NHITZalo`](https://github.com/data1990/NHITZalo/releases/tag/NHITZalo) khi mở ứng dụng và mỗi 4 giờ. Nếu có phiên bản cao hơn, ứng dụng tự tải, cài đặt im lặng và khởi động lại. Người dùng cũng có thể kiểm tra thủ công từ biểu tượng khay hệ thống → **Kiểm tra cập nhật**. Ứng dụng có thể khởi động lại ngay sau khi tải xong, nên cần lưu nội dung đang soạn.

Để phát hành bản mới:

1. Tăng `version` trong `package.json` (và `package-lock.json`), rồi chạy `npm run build:win`.
2. Mở release **công khai** mang tag cố định `NHITZalo` (không để Draft). Xóa các tệp cài đặt và metadata của phiên bản cũ khỏi release này.
3. Tải lên **cùng release đó** ba tệp trong `dist/`: `NHIT-Zalo-Setup-<version>-x64.exe`, tệp `.exe.blockmap` tương ứng và **`latest.yml` sau cùng**. Giữ nguyên tên và nội dung các tệp do build tạo ra; `latest.yml` phải trỏ đến đúng installer và checksum của lần build này.

GitHub phải cho phép sửa asset của release `NHITZalo`; nếu bật **Immutable releases**, không thể thay các tệp của release đã xuất bản. Kho hoặc release cần truy cập công khai để ứng dụng của người dùng tải được. Bản cài đặt đã phát hành trước khi có tính năng này cần được cài thủ công một lần để nhận cập nhật tự động về sau.

### Phiên Zalo trên hosting PHP

Website dùng PHP/MySQL trên aaPanel; VPS không cần Node.js hoặc Docker. Build giao diện MUI X Pro trên máy phát triển bằng `npm run build:php:aapanel`, tải **một tệp ZIP** trong `deploy/php-aapanel/` lên VPS theo [hướng dẫn aaPanel](docs/php-aapanel-session.md). Trong Electron, mở **Cài đặt → Phiên Zalo trên hosting** để nhập mã ghép nối một lần từ website. Khi khởi động, ứng dụng tải session từ hosting rồi mới đăng nhập Zalo.

Các hướng dẫn Node Web Host trước đây trong `docs/web-host-*.md` chỉ dành cho bản cũ.
---

## 📖 Hướng Dẫn Sử Dụng

1. **Khởi chạy ứng dụng**: Chọn tài khoản. Lần đầu nâng cấp, bấm **Bỏ qua mật khẩu và mở** để dùng ngay, hoặc bấm **Đặt mật khẩu** nếu muốn khóa tài khoản. Sau khi chọn, bảng điều khiển và bong bóng chat xuất hiện.
2. **Đăng nhập Zalo**:
   - Trong bảng điều khiển, bấm **"Tạo mã QR đăng nhập"**.
   - Mở app **Zalo** trên điện thoại > Chọn biểu tượng **Quét mã QR** > Quét mã trên màn hình máy tính > Bấm **Đăng nhập**.
3. **Trải nghiệm Bong bóng Chat**:
   - Khi có tin nhắn đến (hoặc bấm nút **"Thử tin nhắn mẫu"**), bong bóng tròn sẽ phát sáng sóng xung kích, hiện số tin nhắn chưa đọc và phát âm thanh chuông thông báo.
   - Bấm vào bong bóng tròn để bung ra khung xem chi tiết tin nhắn.
   - Nhập nội dung vào ô trả lời nhanh và nhấn Enter để gửi trả lời qua Zalo.
   - Bấm nút gạch ngang để thu gọn lại thành icon tròn.
