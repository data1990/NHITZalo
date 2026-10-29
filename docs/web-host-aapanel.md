# Chạy NHIT Zalo Web trên aaPanel/Ubuntu bằng Docker

Nếu bạn **không dùng Docker và không cài Node.js toàn hệ thống**, dùng [hướng dẫn Node portable + aaPanel Supervisor](web-host-aapanel-portable.md).

**Không cần cài Node.js hoặc npm trên Ubuntu host.** Node.js nằm trong Docker image của Web Host. VPS cần Docker Engine/Compose (có thể cài bằng mục **Docker** của aaPanel), MySQL/MariaDB của aaPanel và Nginx. Ứng dụng giữ nguyên đăng nhập QR Zalo, tài khoản admin, đăng ký người dùng và admin duyệt; session Zalo mã hóa nằm trong MySQL.

## 1. Chuẩn bị Docker, database và tệp bí mật

Kiểm tra Docker trong Terminal aaPanel:

```bash
docker --version
docker compose version
```

Nếu chưa có, dùng mục **Docker** của aaPanel hoặc làm theo [hướng dẫn cài Docker Engine cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/) và [Compose plugin](https://docs.docker.com/compose/install/linux/). Không cần cài Node.js trên host. aaPanel có [trình quản lý Docker Compose](https://www.aapanel.com/docs/Function/Docker.html); các lệnh bên dưới cũng chạy được trong Terminal aaPanel.

Trong aaPanel **Databases → MySQL**, tạo database `zalo` và user `zalo` nếu chưa có. User này cần quyền tạo bảng, đọc và ghi trong database `zalo`. Nếu tên khác, sửa `WEB_DB_NAME` và `WEB_DB_USER` trong `compose.yaml`.

Tạo hai tệp bí mật **ngoài** `/www/wwwroot`:

```bash
install -d -m 700 /www/server/nhitzalo-web
install -d -m 700 /www/server/nhitzalo-web/data
nano /www/server/nhitzalo-web/admin-password
nano /www/server/nhitzalo-web/db-password
chmod 600 /www/server/nhitzalo-web/admin-password /www/server/nhitzalo-web/db-password
```

`admin-password` chỉ chứa mật khẩu admin Web Host dài ít nhất 12 ký tự; phải giữ nguyên nếu đã có session cũ. `db-password` chỉ chứa mật khẩu MySQL của user `zalo`. Mỗi tệp có một dòng mật khẩu, không có `KEY=` phía trước. Nếu đã tạo hai tệp này theo hướng dẫn cũ, dùng lại chúng; không ghi đè. Nếu mật khẩu database đã lộ, đổi nó trong aaPanel và cập nhật `db-password`.

## 2. Tải và chạy gói Docker

Trên máy phát triển, chạy `npm run build:web:aapanel`, nén **nội dung** `dist/aaPanel-web-host`, rồi tải lên `/www/wwwroot/zalo.ngochoangit.net`. Gói phát hành đã có `Dockerfile`, `compose.yaml`, `server.js` và `public/`.

Trong Terminal aaPanel:

```bash
cd /www/wwwroot/zalo.ngochoangit.net
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web
curl -i http://127.0.0.1:3177/api/health
```

Kết quả health đúng là JSON `{"ok":true}`. Compose dùng `network_mode: host` trên Ubuntu: Node trong container nghe `127.0.0.1:3177` của VPS và kết nối MySQL ở `127.0.0.1:3306`. Không cần mở cổng `3177` ra Internet. Nếu cổng `3177` đang được project Node cũ dùng, dừng project cũ trong aaPanel trước khi chạy container.

`compose.yaml` gắn hai tệp mật khẩu vào container ở chế độ chỉ đọc và gắn `/www/server/nhitzalo-web/data` để nhập dữ liệu tệp cũ nếu có. Dữ liệu tài khoản/session mới được lưu trong MySQL. Nếu thư mục `data` cũ đang ở `/www/wwwroot/zalo.ngochoangit.net/data`, hãy sao lưu và chuyển nội dung vào `/www/server/nhitzalo-web/data` **trước** lần chạy đầu; không xóa bản cũ trước khi xác nhận đã nhập thành công.

Để cập nhật phiên bản sau này, thay tệp mã trong thư mục website, giữ nguyên tệp bí mật/database, rồi chạy lại `docker compose up -d --build`.

## 3. Trỏ domain tới container trong aaPanel

Domain `zalo.ngochoangit.net` đang được Nginx phục vụ như website tĩnh. Trong aaPanel, mở website này → **Reverse Proxy** → thêm proxy cho **toàn bộ `/`**:

| Trường | Giá trị |
| --- | --- |
| Proxy directory | `/` |
| Target URL | `http://127.0.0.1:3177` |
| Sent host | `$host` |
| Proxy cache | Tắt |

Giữ SSL/HTTPS cho domain. Kiểm tra:

```bash
curl -i http://127.0.0.1:3177/api/health
curl -i https://zalo.ngochoangit.net/api/health
```

**Cả hai** phải trả JSON. Nếu URL localhost trả JSON nhưng URL domain trả 404 HTML, proxy của website chưa chuyển `/api/*` tới container. Sửa quy tắc Nginx/aaPanel; việc đổi database hoặc cài lại ứng dụng không giải quyết lỗi này. Xem [hướng dẫn Reverse Proxy của aaPanel](https://www.aapanel.com/docs/Function/proxy.html).

## 4. Đăng nhập và sao lưu

Mở `https://zalo.ngochoangit.net/`. Tên đăng nhập quản trị đầu tiên là **`admin`**, mật khẩu nằm trong `/www/server/nhitzalo-web/admin-password`. Người dùng khác có thể đăng ký nhưng phải được admin duyệt. Mỗi người chỉ quản lý tài khoản Zalo của mình.

Ứng dụng tự tạo bảng `web_meta`, `web_users`, `web_accounts`. Nếu có `accounts.json` cũ trong thư mục dữ liệu, ứng dụng sẽ nhập vào MySQL và đổi tên tệp thành `accounts.json.migrated`; không tự xóa các tệp session cũ. Sao lưu **database** cùng tệp `admin-password` để có thể giải mã session sau khi khôi phục.
