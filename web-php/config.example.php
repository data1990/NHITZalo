<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && !defined('NHITZALO_INTERNAL')) { http_response_code(404); exit; }
// Copy to config.php in the website directory. Block direct HTTP access in aaPanel.
return [
    'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=zalo;charset=utf8mb4',
    'db_user' => 'zalo',
    'db_password' => 'CHANGE_ME',
    // Generate with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
    'encryption_key_hex' => 'CHANGE_ME_TO_64_HEX_CHARACTERS',
];
