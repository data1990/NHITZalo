<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/bootstrap.php';

migrate_database();
fwrite(STDOUT, "Đã cập nhật cấu trúc MySQL.\n");
