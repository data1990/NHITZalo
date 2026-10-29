# Triển khai Web Host trên VPS Linux

Bạn không dùng cú pháp PowerShell `$env:...` trên VPS Linux. Web Host đọc mật khẩu quản trị từ **systemd credential** khi chạy như dịch vụ. Không cần ghi mật khẩu vào lệnh khởi động hoặc unit file.

## 1. Chuẩn bị ứng dụng

Cài Node.js (tối thiểu 18) và giải nén gói `nhitzalo-web-host-1.1.10.zip` vào `/opt/nhitzalo` (sao cho tệp máy chủ là `/opt/nhitzalo/src/web/server.js`). Tạo tài khoản dịch vụ nếu chưa có, rồi cài dependency trong thư mục mã nguồn:

```bash
sudo useradd --system --home-dir /var/lib/nhitzalo-web --shell /usr/sbin/nologin nhitzalo
cd /opt/nhitzalo
npm ci --omit=dev
```

Bảo đảm tài khoản `nhitzalo` đọc được `/opt/nhitzalo`. Nếu tài khoản dịch vụ đã tồn tại, bỏ qua lệnh `useradd`. Nếu Node.js không nằm ở `/usr/bin/node`, sửa `ExecStart=` trong unit file theo kết quả `command -v node`.

## 2. Tạo mật khẩu quản trị

```bash
sudo install -d -m 700 /etc/nhitzalo
sudo nano /etc/nhitzalo/web-admin-password
sudo chmod 600 /etc/nhitzalo/web-admin-password
```

Nhập **một mật khẩu riêng dài ít nhất 12 ký tự** vào tệp, không có `WEB_ADMIN_PASSWORD=` ở đầu. Giữ lại mật khẩu này: các session Zalo được mã hóa bằng khóa dẫn xuất từ nó. `systemd` sẽ cấp nội dung tệp cho tiến trình qua `LoadCredential=`.

## 3. Cấu hình dịch vụ

Sao chép [unit mẫu](../deploy/systemd/nhitzalo-web.service) vào `/etc/systemd/system/nhitzalo-web.service`, rồi sửa:

- `User=` và `Group=` nếu tên tài khoản hệ thống khác `nhitzalo`.
- `WorkingDirectory=` và `ExecStart=` theo vị trí mã nguồn và Node.js thực tế.
- `WEB_PUBLIC_ORIGIN=` thành địa chỉ HTTPS thật, ví dụ `https://zalo.tenmiencuaban.vn`.

Khởi động dịch vụ:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nhitzalo-web
sudo systemctl status nhitzalo-web
```

Nhật ký nằm trong `journalctl -u nhitzalo-web -f`. Dữ liệu nằm **ngoài mã nguồn** tại `/var/lib/nhitzalo-web`:

- `accounts.json`: danh sách tài khoản, salt và thông tin kiểm tra mật khẩu; không chứa cookie Zalo.
- `sessions/<id-tài-khoản>.json`: phiên Zalo của từng tài khoản, được mã hóa AES-256-GCM.

Thư mục này không mất khi cập nhật mã nguồn hoặc khởi động lại dịch vụ. Hãy sao lưu **cả thư mục** và tệp mật khẩu quản trị cùng nhau; thiếu mật khẩu thì không thể giải mã bản sao lưu. Nếu triển khai trong container, gắn `/var/lib/nhitzalo-web` vào volume bền vững.

## 4. Đưa ra Internet qua HTTPS

Dịch vụ chỉ nghe `127.0.0.1:3177`. Trỏ domain HTTPS vào VPS và cấu hình Nginx (hoặc reverse proxy tương đương) chuyển yêu cầu tới `http://127.0.0.1:3177`. Ví dụ phần `location` trong server HTTPS:

```nginx
location / {
    proxy_pass http://127.0.0.1:3177;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`WEB_PUBLIC_ORIGIN` phải khớp chính xác với origin của trình duyệt để thao tác POST hoạt động. Không mở trực tiếp cổng 3177 ra Internet. Sau khi HTTPS hoạt động, vào domain, đăng nhập bằng mật khẩu quản trị rồi quét QR Zalo.

Nếu không dùng systemd, có thể đặt đường dẫn tệp bằng `WEB_ADMIN_PASSWORD_FILE=/đường/dẫn/tệp` trong cấu hình hosting. Tệp đó cũng chỉ chứa mật khẩu, không chứa tên biến.
