<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && !defined('NHITZALO_INTERNAL')) { http_response_code(404); exit; }

function config(): array {
    static $config;
    if ($config === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) throw new RuntimeException('Thiếu config.php ngoài thư mục public');
        $config = require $path;
        if (!is_array($config) || !preg_match('/^[a-f0-9]{64}$/i', (string)($config['encryption_key_hex'] ?? ''))) {
            throw new RuntimeException('Cấu hình khóa mã hóa không hợp lệ');
        }
    }
    return $config;
}

function db(): PDO {
    static $pdo;
    if ($pdo === null) {
        $c = config();
        $pdo = new PDO($c['dsn'], $c['db_user'], $c['db_password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function migrate_database(): void {
    $schema = file_get_contents(__DIR__ . '/schema.sql');
    if ($schema === false) throw new RuntimeException('Không đọc được schema.sql');
    foreach (explode(';', $schema) as $statement) {
        $statement = trim($statement);
        if ($statement !== '') db()->exec($statement);
    }
    $column = db()->query("SHOW COLUMNS FROM zalo_accounts LIKE 'zalo_uid'")->fetch();
    if (!$column) db()->exec('ALTER TABLE zalo_accounts ADD COLUMN zalo_uid VARCHAR(40) NULL AFTER label');
    foreach ([
        'disabled_at' => 'DATETIME NULL',
        'session_version' => 'INT UNSIGNED NOT NULL DEFAULT 1',
        'reset_required' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'max_zalo_accounts' => 'INT UNSIGNED NOT NULL DEFAULT 2',
        'plan_tier' => "VARCHAR(32) NOT NULL DEFAULT 'free'",
        'plan_expires_at' => 'DATETIME NULL',
        'last_login_at' => 'DATETIME NULL',
    ] as $name => $definition) {
        if (!db()->query("SHOW COLUMNS FROM users LIKE '$name'")->fetch()) {
            db()->exec("ALTER TABLE users ADD COLUMN $name $definition");
        }
    }
    if (!db()->query("SHOW COLUMNS FROM device_tokens LIKE 'last_used_at'")->fetch()) {
        db()->exec('ALTER TABLE device_tokens ADD COLUMN last_used_at DATETIME NULL');
    }
}

function encrypt_session(array $value, int $accountId): string {
    $key = hex2bin(config()['encryption_key_hex']);
    $nonce = random_bytes(12);
    $plain = json_encode($value, JSON_THROW_ON_ERROR);
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag, 'zalo-account:' . $accountId);
    if ($cipher === false) throw new RuntimeException('Không mã hóa được phiên');
    return json_encode(['v' => 1, 'n' => base64_encode($nonce), 'c' => base64_encode($cipher), 't' => base64_encode($tag)], JSON_THROW_ON_ERROR);
}

function decrypt_session(string $payload, int $accountId): array {
    $data = json_decode($payload, true, 32, JSON_THROW_ON_ERROR);
    $plain = openssl_decrypt(base64_decode($data['c'], true), 'aes-256-gcm', hex2bin(config()['encryption_key_hex']),
        OPENSSL_RAW_DATA, base64_decode($data['n'], true), base64_decode($data['t'], true), 'zalo-account:' . $accountId);
    if ($plain === false) throw new RuntimeException('Không giải mã được phiên; kiểm tra khóa mã hóa');
    return json_decode($plain, true, 64, JSON_THROW_ON_ERROR);
}
