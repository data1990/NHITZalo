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

---

## 📖 Hướng Dẫn Sử Dụng

1. **Khởi chạy ứng dụng**: Bảng điều khiển và bong bóng chat hình tròn màu xanh Zalo sẽ xuất hiện ở góc màn hình.
2. **Đăng nhập Zalo**:
   - Trong bảng điều khiển, bấm **"Tạo mã QR đăng nhập"**.
   - Mở app **Zalo** trên điện thoại > Chọn biểu tượng **Quét mã QR** > Quét mã trên màn hình máy tính > Bấm **Đăng nhập**.
3. **Trải nghiệm Bong bóng Chat**:
   - Khi có tin nhắn đến (hoặc bấm nút **"Thử tin nhắn mẫu"**), bong bóng tròn sẽ phát sáng sóng xung kích, hiện số tin nhắn chưa đọc và phát âm thanh chuông thông báo.
   - Bấm vào bong bóng tròn để bung ra khung xem chi tiết tin nhắn.
   - Nhập nội dung vào ô trả lời nhanh và nhấn Enter để gửi trả lời qua Zalo.
   - Bấm nút gạch ngang để thu gọn lại thành icon tròn.
