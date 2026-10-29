# Quản lý phiên Zalo qua web

Web host chạy bằng Node.js. Mỗi tài khoản có mã QR đăng nhập riêng; sau khi xác nhận trên điện thoại, phiên được mã hóa AES-256-GCM trong tệp `sessions/<id>.json` riêng. `accounts.json` chỉ giữ danh sách tài khoản và dữ liệu kiểm tra mật khẩu. Cookie Zalo không được gửi về trình duyệt hoặc trả qua API.

## Bật từ ứng dụng Electron

Mở **Cài đặt → Quản lý tài khoản Zalo qua Web Host**, nhập mật khẩu quản trị web dài ít nhất 12 ký tự rồi bấm **Bật Web Host**. Bấm **Mở trang web** để vào `http://127.0.0.1:3177`. Web Host chạy khi ứng dụng Electron còn mở; để bật lại sau khi khởi động ứng dụng, nhập lại cùng mật khẩu. Dữ liệu web được lưu trong thư mục `web-host` thuộc dữ liệu ứng dụng Electron.

## Chạy Node.js độc lập trên máy hiện tại

Trong PowerShell, tại thư mục dự án:

```powershell
$env:WEB_ADMIN_PASSWORD = 'một-mật-khẩu-riêng-dài-ít-nhất-12-ký-tự'
npm run web:start
```

Mở `http://127.0.0.1:3177`, nhập mật khẩu quản trị, thêm tài khoản rồi bấm **Đăng nhập QR**. Quét mã trong ứng dụng Zalo trên điện thoại và xác nhận. Khi khởi động lại web host với cùng mật khẩu, máy chủ sẽ kết nối lại bằng các phiên đã lưu.

Mặc định dữ liệu nằm tại `%APPDATA%\nhitzalo-web-host` trên Windows. Có thể đổi thư mục bằng `WEB_DATA_DIR` và cổng bằng `WEB_PORT`. **Giữ nguyên mật khẩu quản trị** khi khởi động lại; mật khẩu khác sẽ không giải mã được các phiên đã lưu.

## Truy cập từ thiết bị khác

Web host mặc định chỉ nghe trên `127.0.0.1`. Để truy cập từ xa, đặt nó sau một reverse proxy HTTPS có xác thực và cấu hình `WEB_PUBLIC_ORIGIN` đúng với địa chỉ HTTPS bên ngoài. Có thể đổi `WEB_HOST` khi cần, nhưng máy chủ sẽ không cho nghe trên mạng nếu không đặt `WEB_PUBLIC_ORIGIN` là HTTPS. Bảo vệ thư mục dữ liệu web host bằng quyền hệ điều hành và sao lưu nó cùng mật khẩu quản trị.

Web host có kho phiên riêng. Nó chưa tự nhập phiên vào ứng dụng Electron; các phiên Electron hiện tại tiếp tục được mã hóa bằng cơ chế của hệ điều hành và không bị thay đổi.

Nếu triển khai trên VPS Linux, làm theo [hướng dẫn systemd và HTTPS](web-host-linux.md). Mật khẩu có thể được cấp qua tệp `systemd` credential thay cho biến môi trường PowerShell.

Nếu VPS Ubuntu dùng aaPanel và không cài Node.js trên host, làm theo [hướng dẫn aaPanel bằng Docker với MySQL/MariaDB](web-host-aapanel.md) và tạo gói Web Host gọn bằng `npm run build:web:aapanel`. Bản aaPanel có đăng ký người dùng, admin duyệt tài khoản và session Zalo mã hóa trong database. Nginx cần reverse proxy toàn bộ domain, gồm `/api/*`, tới container ở `127.0.0.1:3177`.

Nếu không dùng Docker, làm theo [hướng dẫn Node portable với aaPanel Supervisor](web-host-aapanel-portable.md) và tạo gói bằng `npm run build:web:portable`. Không cần cài Node.js toàn hệ thống; bản portable chỉ nằm trong thư mục riêng của ứng dụng.
