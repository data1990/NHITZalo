<?php
declare(strict_types=1);
require dirname(__DIR__) . '/bootstrap.php';
if (PHP_SAPI !== 'cli') exit(1);
$username = $argv[1] ?? 'admin';
if (!preg_match('/^[a-z0-9_.-]{3,40}$/', $username)) throw new RuntimeException('Tên admin không hợp lệ');
migrate_database();
fwrite(STDOUT, "Nhập mật khẩu admin (không hiện trên màn hình): ");
$interactive = function_exists('stream_isatty') && stream_isatty(STDIN);
if ($interactive) system('stty -echo');
try {
    $line = fgets(STDIN);
    if ($line === false) throw new RuntimeException('Không đọc được mật khẩu. Hãy chạy lệnh trong Terminal aaPanel có thể nhập tương tác.');
    $password = rtrim($line, "\r\n");
}
finally { if ($interactive) system('stty echo'); fwrite(STDOUT, PHP_EOL); }
if (strlen($password) < 12) throw new RuntimeException('Mật khẩu phải có ít nhất 12 ký tự');
$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = db()->prepare("INSERT INTO users (username,password_hash,role,approved) VALUES (?,?,?,1)
    ON DUPLICATE KEY UPDATE password_hash=?,role=?,approved=1,disabled_at=NULL,reset_required=0,session_version=session_version+1");
$stmt->execute([$username, $hash, 'admin', $hash, 'admin']);
fwrite(STDOUT, "Đã tạo hoặc cập nhật admin: $username\n");
