# aaPanel/Ubuntu không Docker, không cài Node.js toàn hệ thống

Web Host cần một JavaScript runtime để dùng thư viện đăng nhập QR Zalo. Gói này tải **Node.js portable** vào `/www/server/nhitzalo-web/runtime` và chỉ dùng cho ứng dụng; không cài bằng `apt`, không thêm vào `/usr/bin`, không dùng Docker. Tài khoản và session Zalo vẫn lưu mã hóa trong MySQL/MariaDB của aaPanel.

## 1. Chuẩn bị gói và mật khẩu

Trên máy phát triển, chạy `npm run build:web:portable`. Tải ZIP portable lên VPS rồi giải nén **nội dung** vào `/www/wwwroot/zalo.ngochoangit.net`, sao cho có `server.js`, `setup-portable.sh`, `run-portable.sh` ngay trong thư mục này. Bản portable không chứa Dockerfile hoặc Compose.

Trong aaPanel **Databases → MySQL**, tạo database `zalo` và user `zalo` nếu chưa có. User này cần quyền tạo bảng, đọc và ghi. Nếu dùng tên khác, sửa `WEB_DB_NAME` và `WEB_DB_USER` trong `start.sh`.

Tạo hai tệp mật khẩu ngoài thư mục website; nếu đã có từ bản trước thì **giữ nguyên**:

```bash
install -d -m 700 /www/server/nhitzalo-web
install -d -m 700 /www/server/nhitzalo-web/data
nano /www/server/nhitzalo-web/admin-password
nano /www/server/nhitzalo-web/db-password
chmod 600 /www/server/nhitzalo-web/admin-password /www/server/nhitzalo-web/db-password
```

`admin-password` là mật khẩu admin Web Host dài ít nhất 12 ký tự; giữ nguyên nếu đã lưu session vì khóa mã hóa được dẫn xuất từ mật khẩu đó. `db-password` là mật khẩu MySQL của user `zalo`. Mỗi tệp chỉ chứa một dòng mật khẩu. Không đặt hai tệp này trong `/www/wwwroot`.

## 2. Chuẩn bị Node portable ngay trong thư mục riêng

Chạy trong Terminal aaPanel:

```bash
cd /www/wwwroot/zalo.ngochoangit.net
sh setup-portable.sh
```

Script tự nhận diện `x86_64` hoặc `aarch64`, tải binary Node.js 24.22.0 từ [nodejs.org](https://nodejs.org/en/download), kiểm tra SHA-256, giải nén vào `/www/server/nhitzalo-web/runtime`, rồi dùng npm **của bản portable** để cài dependency của Web Host. Ubuntu host không cần lệnh `node` hoặc `npm` được cài sẵn. Cần có `curl`, `tar`, `xz`, `sha256sum` và kết nối Internet khi chạy bước này.

Để aaPanel Supervisor chạy bằng user `www`, cấp quyền đọc runtime và tệp bí mật:

```bash
chown www:www /www/server/nhitzalo-web
chown -R www:www /www/server/nhitzalo-web/runtime /www/server/nhitzalo-web/data
chown www:www /www/server/nhitzalo-web/admin-password /www/server/nhitzalo-web/db-password
chmod 700 /www/server/nhitzalo-web /www/server/nhitzalo-web/data
chmod 600 /www/server/nhitzalo-web/admin-password /www/server/nhitzalo-web/db-password
```

Nếu trước đó có `accounts.json` và `sessions/` trong một thư mục `data` khác, sao lưu rồi chuyển vào `/www/server/nhitzalo-web/data` trước lần chạy đầu. Ứng dụng sẽ nhập vào MySQL mà không xóa các tệp session cũ.

## 3. Chạy bằng Supervisor của aaPanel

Trong aaPanel **App Store → Tools → Supervisor**, thêm tiến trình:

| Trường | Giá trị |
| --- | --- |
| Name | `nhitzalo-web` |
| Run user | `www` |
| Run directory | `/www/wwwroot/zalo.ngochoangit.net` |
| Start command | `/bin/sh /www/wwwroot/zalo.ngochoangit.net/run-portable.sh` |
| Auto start / restart | Bật |

Supervisor giữ tiến trình Web Host chạy sau khi đóng Terminal hoặc khởi động lại VPS. Xem [tài liệu Supervisor của aaPanel](https://www.aapanel.com/docs/Function/Tools.html). Nếu muốn thử thủ công trước, chạy `sh run-portable.sh` trong Terminal, rồi dùng Terminal khác để kiểm tra `curl -i http://127.0.0.1:3177/api/health`. Nếu cổng `3177` đã bị process cũ chiếm, dừng process cũ trong aaPanel trước khi bật Supervisor.

## 4. Reverse proxy domain vào Web Host

Website tĩnh hiện tại của `zalo.ngochoangit.net` trả 404 HTML cho `/api/health`. Trong aaPanel, mở website này → **Reverse Proxy** → thêm proxy cho **toàn bộ `/`** đến `http://127.0.0.1:3177`, gửi Host `$host`, tắt proxy cache. Giữ SSL/HTTPS của domain.

Kiểm tra cả hai URL:

```bash
curl -i http://127.0.0.1:3177/api/health
curl -i https://zalo.ngochoangit.net/api/health
```

Cả hai phải trả JSON `{"ok":true}`. Nếu localhost trả JSON nhưng domain trả 404 HTML, lỗi nằm ở proxy Nginx, không phải MySQL hay mật khẩu. Xem [tài liệu Reverse Proxy của aaPanel](https://www.aapanel.com/docs/Function/proxy.html).

Sau đó vào `https://zalo.ngochoangit.net/`. Tên đăng nhập đầu tiên là `admin`, mật khẩu nằm trong `admin-password`. Người dùng khác có thể đăng ký nhưng phải chờ admin duyệt.
