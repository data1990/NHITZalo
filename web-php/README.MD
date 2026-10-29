1. Mục đích & Kiến trúc tổng quan
Mục đích: Là hệ thống máy chủ trung gian gọn nhẹ chạy trên hosting/VPS aaPanel (PHP 8.2+ & MySQL), phục vụ lưu trữ tập trung, mã hóa và đồng bộ phiên (session) Zalo an toàn cho ứng dụng Desktop Electron. Máy chủ không cần Node.js hay Docker.
Frontend: Ứng dụng Single Page (SPA) viết bằng React 19 + MUI + MUI X DataGrid Pro, được build tĩnh bằng Vite trên máy phát triển thành HTML/JS đóng gói.
Backend API: PHP thuần kiến trúc REST qua tệp 

api.php
, quản lý dữ liệu bằng PDO MySQL.
2. Cấu trúc thư mục web-php


bootstrap.php
: Nạp cấu hình 

config.php
, kết nối PDO, hàm tự động di chuyển CSDL migrate_database(), hàm mã hóa / giải mã phiên AES-256-GCM. Tự chặn truy cập trực tiếp từ web browser (NHITZALO_INTERNAL).


config.example.php
: Mẫu cấu hình DSN, thông tin đăng nhập MySQL và khóa bí mật encryption_key_hex (chuỗi 64 ký tự hex ngẫu nhiên).


schema.sql
: CSDL gồm 5 bảng:
users: Người dùng web (username, password_hash, role, approved, disabled_at, session_version, reset_required, last_login_at).
zalo_accounts: Hồ sơ Zalo theo owner_id (label, zalo_uid, session_cipher chứa cookie/imei/userInfo đã mã hóa).
device_codes: Mã ghép nối tạm thời (12 hex, hạn 10 phút, lưu dạng SHA-256 hash).
device_tokens: Token thiết bị Electron (64 hex, lưu dạng SHA-256 hash, theo dõi last_used_at và revoked_at).
admin_audit: Nhật ký mọi thao tác quản trị viên.


bin/create-admin.php
: Script CLI tạo / cập nhật tài khoản Admin, tự động khởi chạy migration.


bin/migrate.php
: Script CLI nâng cấp cấu trúc MySQL khi deploy phiên bản mới.


public/
:


api.php
: Điểm tập trung xử lý toàn bộ REST API (Health, Register, Login, Desktop-Login, Me, Change Password, Admin APIs, Device Pairing & Session Sync).
index.html và file build JS/CSS của React frontend.


frontend/
: Mã nguồn giao diện quản trị React (AdminPanel.jsx, main.jsx).
3. Cơ chế Bảo mật & Xác thực
Bắt buộc HTTPS: Từ chối request nếu không chạy trên localhost hoặc không có SSL/HTTPS.
Phiên Web Browser: Cookie session nhitzalo_web (HttpOnly, SameSite=Strict, Secure) kết hợp kiểm tra X-CSRF-Token cho toàn bộ các thao tác POST.
Phiên Desktop Electron:
Xác thực bằng Authorization: Bearer <hex64_token>.
Token gốc chỉ lưu mã hóa trên máy người dùng (qua Electron safeStorage); trên database MySQL chỉ lưu SHA-256 hash của token.
Khi đổi mật khẩu hoặc bị Admin khóa/thu hồi: token và mã ghép nối lập tức bị vô hiệu hóa (revoked_at = UTC_TIMESTAMP()).
Đặt lại mật khẩu bởi Admin: Hỗ trợ 2 chế độ:
- Tự động cập nhật: Hệ thống sinh mật khẩu tạm ngẫu nhiên an toàn (24 ký tự), yêu cầu người dùng phải đổi mật khẩu khi đăng nhập website.
- Tự đặt mật khẩu: Admin tự nhập mật khẩu mới trực tiếp (tối thiểu 12 ký tự) và có thể tùy chọn yêu cầu đổi mật khẩu ở lần đăng nhập sau.
Giới hạn & Gói cước tài khoản Zalo:
- Mặc định: Mỗi tài khoản người dùng được lưu tối đa 2 tài khoản Zalo (Gói Cơ bản / Free).
- Nâng cấp gói: Người dùng có thể xem hạn mức và hướng dẫn nâng cấp (Gói Pro 5 slot, Pro Max 10 slot, Doanh nghiệp 50+ slot).
- Quản trị viên (Admin): Có thể phân quyền, tăng số lượng slot `max_zalo_accounts`, đổi hạng gói và đặt ngày hết hạn trực tiếp từ Admin Panel.
Mã hóa Session Zalo:
Thuật toán: AES-256-GCM với khóa 32 bytes từ encryption_key_hex.
Gắn nonce ngẫu nhiên 12 bytes, tag xác thực 16 bytes và AAD (Additional Authenticated Data) ràng buộc theo zalo-account:<id>, ngăn chặn hoàn toàn việc tráo đổi phiên giữa các tài khoản.
4. Luồng Tương Tác với Ứng Dụng Electron
Đăng nhập trực tiếp (desktop-login): Electron gửi username/password -> Máy chủ xác thực người dùng đã được duyệt -> Cấp token thiết bị 64 hex.
Ghép nối bằng mã (device-code / device-pair): Tạo mã OTP 12 ký tự trên web -> Nhập vào Electron để liên kết tài khoản và sinh thiết bị token.
Đồng bộ phiên Zalo (device-session):
GET: Electron tải về session giải mã để tự động đăng nhập Zalo mà không cần quét QR lại.
PUT: Khi người dùng quét QR mới trong Electron, ứng dụng tải session (cookie, imei, uid) lên hosting để mã hóa lưu trữ.
DELETE: Xóa session trên hosting khi người dùng bấm đăng xuất Zalo.
5. Quy trình Đóng gói & Triển khai
Build Frontend: npm run build:php:ui (Vite build sang web-php/public).
Tạo gói deploy: Chạy lệnh npm run build:php:aapanel thông qua 

scripts/build-php-aapanel.js
 để đóng gói thành 1 file zip duy nhất: deploy/php-aapanel/NHITZalo-aaPanel-PHP-<version>.zip.
Trên VPS: Giải nén trực tiếp vào thư mục web aaPanel, cấu hình Nginx chặn truy cập trực tiếp các file .php quản trị và .sql, chạy create-admin.php admin để kích hoạt.