# Triển khai NHIT Zalo Web trên aaPanel (PHP + MySQL)

Máy chủ Ubuntu **không cần Node.js hoặc Docker**. React/MUI X Pro được build trên máy phát triển rồi tải lên dưới dạng HTML/JS tĩnh. PHP chạy API, MySQL lưu tài khoản người dùng và phiên Zalo đã mã hóa. Electron là cầu nối đăng nhập QR và dùng session trên hosting để tự đăng nhập.

## 1. Build trên máy phát triển

Trong thư mục dự án:

```powershell
cd D:\Electron\NHITZalo
npm install --prefix web-php/frontend
$env:VITE_MUI_LICENSE_KEY = 'MUI_X_PRO_LICENSE_KEY_CUA_BAN'
npm run build:php:aapanel
Remove-Item Env:VITE_MUI_LICENSE_KEY
```

Khóa MUI X Pro được đóng vào frontend theo cơ chế cấp phép của MUI. Không commit khóa vào Git. Sau build, tải **một tệp** `deploy/php-aapanel/NHITZalo-aaPanel-PHP-1.1.21.zip` lên VPS; đừng tải `frontend/node_modules` lên.

## 2. Tải tệp lên VPS

- Tải tệp ZIP duy nhất lên VPS rồi giải nén **trực tiếp trong thư mục website**:

  ```bash
  cd /www/wwwroot/zalo.ngochoangit.net
  unzip -o NHITZalo-aaPanel-PHP-1.1.21.zip
  ```

  ZIP không có thư mục bọc ngoài hoặc thư mục con. Sau giải nén, cùng một thư mục `/www/wwwroot/zalo.ngochoangit.net/` có `index.html`, JavaScript đã build, `api.php`, `bootstrap.php`, `migrate.php`, `create-admin.php`, `config.example.php` và `schema.sql`.
- Website aaPanel: PHP **8.2+** với `pdo_mysql`, `openssl`, `mbstring`; bật HTTPS và HTTP → HTTPS. Không cấu hình reverse proxy tới cổng Node. Document root giữ nguyên `/www/wwwroot/zalo.ngochoangit.net`.

Trong aaPanel, mở **Website → zalo.ngochoangit.net → Config**, thêm các quy tắc sau bên trong `server { ... }`, rồi lưu và tải lại Nginx. Chúng chặn truy cập trực tiếp tệp cấu hình và tệp cài đặt trong cùng web root:

```nginx
location = /config.php { return 404; }
location = /config.example.php { return 404; }
location = /bootstrap.php { return 404; }
location = /create-admin.php { return 404; }
location = /migrate.php { return 404; }
location = /schema.sql { return 404; }
```

Các tệp PHP quản trị cũng tự chặn truy cập không đúng ngữ cảnh khi PHP đang chạy. Vẫn cần các quy tắc Nginx trên để bảo vệ cả trường hợp PHP bị cấu hình sai.

## 3. Cấu hình MySQL và admin

Tạo database/user MySQL trong aaPanel. Trên VPS:

```bash
cd /www/wwwroot/zalo.ngochoangit.net
if [ ! -f config.php ] && [ -f /www/wwwroot/zalo.ngochoangit.net-private/config.php ]; then
  cp /www/wwwroot/zalo.ngochoangit.net-private/config.php config.php
fi
if [ ! -f config.php ]; then cp config.example.php config.php; fi
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Nếu đây là lần cài mới, sửa `config.php`: DSN, user, mật khẩu MySQL và `encryption_key_hex` bằng chuỗi 64 ký tự hex vừa tạo. Nếu đã có `config.php` và session cũ, **giữ nguyên khóa mã hóa**. Lệnh trên không ghi đè cấu hình hiện có.

```bash
chown root:www /www/wwwroot/zalo.ngochoangit.net/config.php
chmod 640 /www/wwwroot/zalo.ngochoangit.net/config.php
php /www/wwwroot/zalo.ngochoangit.net/create-admin.php admin
```

`create-admin.php` tự tạo/cập nhật bảng MySQL trước khi hỏi mật khẩu. Lệnh sẽ tạo admin mới hoặc chuyển tài khoản `admin` đã đăng ký nhầm trên web thành admin và đặt lại mật khẩu; chạy lại lệnh cũng đặt lại mật khẩu admin. Mật khẩu cần ít nhất 12 ký tự. `migrate.php` dành cho lần nâng cấp cấu trúc database sau này. Nếu `php` không nằm trong PATH, dùng binary PHP aaPanel, ví dụ `/www/server/php/82/bin/php`.

**Khi nâng cấp website đang dùng lên 1.1.21:** Sao lưu MySQL trong aaPanel trước, giải nén ZIP mới tại thư mục website rồi chạy:

```bash
cd /www/wwwroot/zalo.ngochoangit.net
php migrate.php
```

Nếu `php` không nằm trong PATH, dùng `/www/server/php/82/bin/php migrate.php`. Lệnh này thêm các cột trạng thái người dùng, phiên đăng nhập, thời điểm hoạt động thiết bị và bảng nhật ký admin; tài khoản và phiên Zalo hiện có được giữ nguyên. Không chạy lại `create-admin.php` khi chỉ nâng cấp, vì lệnh đó đặt lại mật khẩu admin.

## Quản trị hệ thống

Đăng nhập tài khoản admin trên website để dùng các mục **Tổng quan**, **Người dùng**, **Tài khoản Zalo** và **Nhật ký**:

- **Người dùng:** tìm kiếm, lọc trạng thái, xem chi tiết và tài khoản Zalo, duyệt hoặc từ chối đăng ký, tạm khóa/mở lại, quản lý gói cước (hạn mức tối đa 2 tài khoản cho gói Free, Pro 5, Pro Max 10 hoặc Doanh nghiệp), đặt lại mật khẩu (hỗ trợ 2 chế độ: tự động cập nhật mật khẩu tạm ngẫu nhiên hoặc admin tự đặt mật khẩu mới).
- **Tài khoản Zalo:** xem chủ sở hữu, trạng thái phiên và thiết bị; thu hồi từng thiết bị hoặc tất cả thiết bị; xóa phiên trên máy chủ khi cần người dùng quét QR lại.
- **Nhật ký:** xem admin nào đã thực hiện các thao tác quản trị. Mật khẩu, token và nội dung session không hiển thị trong trang này.

Mặc định mỗi người dùng được lưu tối đa 2 tài khoản Zalo. Khi đạt giới hạn, người dùng cần liên hệ Admin để nâng cấp gói. Admin có thể thay đổi số lượng slot tài khoản Zalo tối đa, hạng gói và ngày hết hạn trực tiếp từ Admin Panel. Khi admin đặt lại mật khẩu, có 2 lựa chọn: **Tự động cập nhật** (hệ thống sinh mật khẩu ngẫu nhiên an toàn, hiển thị 1 lần để copy và bắt buộc người dùng đổi mật khẩu khi đăng nhập web) hoặc **Tự đặt mật khẩu** (admin tự nhập mật khẩu tối thiểu 12 ký tự và có thể tùy chọn yêu cầu đổi mật khẩu ở lần đăng nhập tiếp theo). Cả hai cách đều thu hồi token các thiết bị Electron cũ và hủy phiên đăng nhập trước đó để đảm bảo an toàn. Khóa tài khoản sẽ làm hết hiệu lực phiên web và thu hồi quyền các thiết bị; mở lại tài khoản không khôi phục các token cũ.

## 4. Ghép nối Electron

**Đăng ký và đăng nhập từ màn hình chọn tài khoản:** Mở bản Electron 1.1.21, bấm **Đăng nhập web**. Địa chỉ `https://zalo.ngochoangit.net` đã được cấu hình trong ứng dụng nên không cần nhập. Người dùng mới chọn **Đăng ký nhanh**, điền tên đăng nhập và mật khẩu rồi đợi admin duyệt trên website. Khi đã được duyệt, dùng tab **Đăng nhập**. Nếu người dùng có nhiều tài khoản Zalo trên website, chọn tài khoản cần mở. Electron lưu mã thiết bị đã mã hóa trên máy, tải session Zalo từ MySQL và tự cập nhật session lên máy chủ sau khi đăng nhập Zalo bằng QR. Mật khẩu web không được lưu trong Electron. Trên máy khác, cài Electron rồi đăng nhập cùng tài khoản web để dùng session còn hiệu lực. Nếu chưa có session Zalo trên máy chủ, quét QR trong Electron sau khi đăng nhập web.

Từ Electron 1.1.21, nếu hồ sơ cục bộ và hồ sơ web trên cùng máy có cùng ID Zalo, ứng dụng tự gộp danh sách và hợp nhất lịch sử tin nhắn khi khởi động. Hồ sơ trùng được lưu ở `merged-accounts/<ID>` trong thư mục dữ liệu ứng dụng để dự phòng; tài khoản khác ID Zalo vẫn tách riêng.

**Dùng cục bộ:** Chọn tài khoản đã lưu hoặc **Thêm tài khoản mới** mà không đăng nhập web. Session và dữ liệu sẽ lưu riêng trên máy này. Tài khoản cục bộ cũ vẫn còn sau khi nâng cấp.

**Cách ghép nối bằng mã (nếu muốn giữ hồ sơ cục bộ hiện có):**

1. Mở `https://zalo.ngochoangit.net`, đăng nhập admin. Người dùng khác có thể đăng ký; admin cần duyệt ở bảng phía dưới.
2. Thêm tài khoản Zalo, bấm **Tạo mã ghép nối**. Mã 12 ký tự chỉ dùng một lần và hết hạn sau 10 phút.
3. Trong ứng dụng Electron, chọn đúng tài khoản cục bộ rồi vào **Cài đặt ứng dụng → Phiên Zalo trên hosting**. Nhập URL `https://zalo.ngochoangit.net` và mã ghép nối.
   Bấm **Kiểm tra kết nối** để xác minh PHP/MySQL, rồi **Kết nối**. Khi kết nối thành công, ứng dụng hiển thị tên tài khoản và nút **Ngắt kết nối**.
4. Nếu Electron đã có session, session đó được tải lên hosting khi ghép nối. Nếu hosting đã có session, Electron tải về và đăng nhập. Sau lần quét QR mới, Electron tự cập nhật session trên hosting. Khi đăng xuất Zalo trong Electron, session trên hosting cũng bị xóa. Khi đã ghép nối, ứng dụng cần kết nối được hosting để tự đăng nhập; bản cục bộ không thay thế phiên hosting.

**Ngắt kết nối** thu hồi quyền thiết bị với hosting và gỡ ghép nối trên máy; thao tác này không tự đăng xuất phiên Zalo đang mở trong Electron.

Mã truy cập thiết bị chỉ lưu trên máy dưới dạng mã hóa hệ điều hành. PHP chỉ lưu hash của mã này trong MySQL. Session Zalo được mã hóa AES-256-GCM trước khi ghi MySQL. Phải bảo vệ cả bản sao lưu database lẫn khóa trong `config.php`.

## Kiểm tra nhanh

```bash
php -l /www/wwwroot/zalo.ngochoangit.net/api.php
php -l /www/wwwroot/zalo.ngochoangit.net/bootstrap.php
curl -i https://zalo.ngochoangit.net/api.php?action=me
curl -i https://zalo.ngochoangit.net/api.php?action=health
```

Lệnh `me` phải trả HTTP `401` với JSON `{"error":"Chưa đăng nhập"}`; lệnh `health` phải trả HTTP `200` với `{"ok":true,"database":true}`. Nếu nhận HTML hoặc `Unexpected token '<'`, aaPanel đang trỏ sai document root, `api.php` chưa được tải lên, hoặc PHP chưa chạy. Nếu `health` trả `503`, kiểm tra `config.php`, MySQL và PHP error log của website.
