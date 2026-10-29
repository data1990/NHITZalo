<?php
declare(strict_types=1);
define('NHITZALO_INTERNAL', true);
require dirname(__DIR__) . '/bootstrap.php';

if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)
    && (($_SERVER['HTTPS'] ?? '') !== 'on')) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"error":"Cần truy cập qua HTTPS"}';
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function reply(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}
function fail(string $message, int $status = 400): never { reply(['error' => $message], $status); }
function input(): array {
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 2_000_000) fail('Dữ liệu quá lớn', 413);
    try { return json_decode($raw ?: '{}', true, 64, JSON_THROW_ON_ERROR); }
    catch (Throwable $e) { fail('JSON không hợp lệ'); }
}
function browser_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('nhitzalo_web');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true), 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
}
function current_user(bool $allowReset = false): array {
    browser_session();
    $id = (int)($_SESSION['user_id'] ?? 0);
    if (!$id) fail('Chưa đăng nhập', 401);
    $stmt = db()->prepare('SELECT id,username,role,approved,disabled_at,reset_required,session_version,max_zalo_accounts,plan_tier,plan_expires_at FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user || !$user['approved'] || $user['disabled_at'] !== null) fail('Tài khoản không còn quyền truy cập', 403);
    if ((int)($_SESSION['session_version'] ?? 1) !== (int)$user['session_version']) fail('Phiên đăng nhập đã hết hiệu lực', 401);
    if (!$allowReset && (int)$user['reset_required'] === 1) fail('Cần đổi mật khẩu trước khi tiếp tục', 403);
    return $user;
}
function admin_user(): array {
    $user = current_user();
    if ($user['role'] !== 'admin') fail('Chỉ admin được truy cập', 403);
    return $user;
}
function admin_audit(int $actorId, string $action, string $targetType, int $targetId, string $detail = ''): void {
    $stmt = db()->prepare('INSERT INTO admin_audit (actor_id,action,target_type,target_id,detail) VALUES (?,?,?,?,?)');
    $stmt->execute([$actorId, $action, $targetType, $targetId, mb_substr($detail, 0, 255)]);
}
function admin_page(): array {
    $page = max(1, min(100000, (int)($_GET['page'] ?? 1)));
    $limit = max(10, min(100, (int)($_GET['limit'] ?? 25)));
    return [$page, $limit, ($page - 1) * $limit];
}
function admin_account(int $id): array {
    $stmt = db()->prepare('SELECT a.id,a.owner_id,a.label,a.zalo_uid,a.session_cipher IS NOT NULL AS has_session,a.updated_at,u.username AS owner FROM zalo_accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=?');
    $stmt->execute([$id]);
    $account = $stmt->fetch();
    if (!$account) fail('Không tìm thấy tài khoản Zalo', 404);
    return $account;
}
function require_csrf(): void {
    browser_session();
    $expected = $_SESSION['csrf'] ?? '';
    $actual = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$expected || !hash_equals($expected, $actual)) fail('CSRF token không hợp lệ', 403);
}
function owned_account(int $id, int $owner): array {
    $stmt = db()->prepare('SELECT id,label,session_cipher,updated_at FROM zalo_accounts WHERE id=? AND owner_id=?');
    $stmt->execute([$id, $owner]);
    $account = $stmt->fetch();
    if (!$account) fail('Không tìm thấy tài khoản Zalo', 404);
    return $account;
}
function device_account(): array {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer ([a-f0-9]{64})$/i', $auth, $match)) fail('Thiếu mã thiết bị', 401);
    $hash = hash('sha256', hex2bin($match[1]));
    $stmt = db()->prepare('SELECT t.id AS device_id,a.id,a.label,a.session_cipher,a.updated_at FROM device_tokens t JOIN zalo_accounts a ON a.id=t.account_id JOIN users u ON u.id=a.owner_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND u.approved=1 AND u.disabled_at IS NULL AND u.reset_required=0');
    $stmt->execute([$hash]);
    $account = $stmt->fetch();
    if (!$account) fail('Mã thiết bị không hợp lệ', 401);
    $stmt = db()->prepare('UPDATE device_tokens SET last_used_at=UTC_TIMESTAMP() WHERE id=? AND (last_used_at IS NULL OR last_used_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))');
    $stmt->execute([$account['device_id']]);
    return $account;
}

try {
    $action = (string)($_GET['action'] ?? '');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($action === 'health' && $method === 'GET') {
        try { db()->query('SELECT 1')->fetchColumn(); }
        catch (Throwable $e) { error_log('NHITZalo health: ' . $e->getMessage()); fail('PHP hoạt động nhưng không kết nối được MySQL hoặc cấu hình chưa hoàn tất', 503); }
        reply(['ok' => true, 'database' => true]);
    }
    if ($action === 'register' && $method === 'POST') {
        $data = input();
        $username = strtolower(trim((string)($data['username'] ?? '')));
        $password = (string)($data['password'] ?? '');
        if (!preg_match('/^[a-z0-9_.-]{3,40}$/', $username) || strlen($password) < 12) fail('Tên đăng nhập hoặc mật khẩu không hợp lệ');
        if ($username === 'admin') fail('Tên admin chỉ được tạo bằng lệnh quản trị trên máy chủ', 409);
        try {
            $stmt = db()->prepare('INSERT INTO users (username,password_hash,role,approved) VALUES (?,?,?,0)');
            $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), 'user']);
        } catch (PDOException $e) { fail('Tên đăng nhập đã tồn tại', 409); }
        reply(['success' => true, 'message' => 'Đã đăng ký, chờ admin duyệt']);
    }
    if ($action === 'login' && $method === 'POST') {
        $data = input();
        $stmt = db()->prepare('SELECT id,username,password_hash,role,approved,disabled_at,reset_required,session_version FROM users WHERE username=?');
        $stmt->execute([strtolower(trim((string)($data['username'] ?? '')))]);
        $user = $stmt->fetch();
        if (!$user || !password_verify((string)($data['password'] ?? ''), $user['password_hash'])) fail('Tên đăng nhập hoặc mật khẩu không đúng', 401);
        if ($user['disabled_at'] !== null) fail('Tài khoản đã bị tạm khóa; liên hệ admin', 403);
        if (!$user['approved']) fail('Tài khoản đang chờ admin duyệt', 403);
        browser_session();
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        $_SESSION['session_version'] = (int)$user['session_version'];
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        $stmt = db()->prepare('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE id=?');
        $stmt->execute([$user['id']]);
        reply(['user' => ['id' => $user['id'], 'username' => $user['username'], 'role' => $user['role'], 'reset_required' => $user['reset_required']], 'csrf' => $_SESSION['csrf']]);
    }
    if ($action === 'desktop-login' && $method === 'POST') {
        $data = input();
        $username = strtolower(trim((string)($data['username'] ?? '')));
        $password = (string)($data['password'] ?? '');
        $stmt = db()->prepare('SELECT id,password_hash,approved,disabled_at,reset_required FROM users WHERE username=?');
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) fail('Tên đăng nhập hoặc mật khẩu không đúng', 401);
        if ($user['disabled_at'] !== null) fail('Tài khoản đã bị tạm khóa; liên hệ admin', 403);
        if (!$user['approved']) fail('Tài khoản đang chờ admin duyệt', 403);
        if ((int)$user['reset_required'] === 1) fail('Cần đổi mật khẩu tạm trên website trước khi đăng nhập ứng dụng', 403);
        $stmt = db()->prepare('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE id=?');
        $stmt->execute([$user['id']]);
        $stmt = db()->prepare('SELECT id,label,session_cipher IS NOT NULL AS has_session FROM zalo_accounts WHERE owner_id=? ORDER BY id DESC');
        $stmt->execute([(int)$user['id']]);
        $accounts = $stmt->fetchAll();
        if (!$accounts) {
            $stmt = db()->prepare('INSERT INTO zalo_accounts (owner_id,label) VALUES (?,?)');
            $stmt->execute([(int)$user['id'], 'Zalo của ' . $username]);
            $accounts = [['id' => (int)db()->lastInsertId(), 'label' => 'Zalo của ' . $username, 'has_session' => 0]];
        }
        $requested = (int)($data['account_id'] ?? 0);
        if (!$requested && count($accounts) > 1) reply(['accounts' => $accounts]);
        $selected = null;
        foreach ($accounts as $account) {
            if ((int)$account['id'] === ($requested ?: (int)$accounts[0]['id'])) { $selected = $account; break; }
        }
        if (!$selected) fail('Tài khoản Zalo không thuộc người dùng này', 403);
        $token = bin2hex(random_bytes(32));
        $stmt = db()->prepare('INSERT INTO device_tokens (account_id,token_hash) VALUES (?,?)');
        $stmt->execute([(int)$selected['id'], hash('sha256', hex2bin($token))]);
        reply(['account' => $selected, 'token' => $token]);
    }
    if ($action === 'me' && $method === 'GET') {
        $user = current_user(true);
        reply(['user' => $user, 'csrf' => $_SESSION['csrf'] ?? '']);
    }
    if ($action === 'logout' && $method === 'POST') {
        current_user(true); require_csrf();
        $_SESSION = []; session_destroy(); reply(['success' => true]);
    }
    if ($action === 'change-password' && $method === 'POST') {
        $user = current_user(true); require_csrf();
        $data = input();
        $current = (string)($data['current_password'] ?? '');
        $next = (string)($data['new_password'] ?? '');
        if (strlen($next) < 12) fail('Mật khẩu mới cần ít nhất 12 ký tự');
        $stmt = db()->prepare('SELECT password_hash FROM users WHERE id=?');
        $stmt->execute([$user['id']]);
        if (!password_verify($current, (string)$stmt->fetchColumn())) fail('Mật khẩu hiện tại không đúng', 401);
        db()->beginTransaction();
        $stmt = db()->prepare('UPDATE users SET password_hash=?,reset_required=0,session_version=session_version+1 WHERE id=?');
        $stmt->execute([password_hash($next, PASSWORD_DEFAULT), $user['id']]);
        $stmt = db()->prepare('UPDATE device_tokens t JOIN zalo_accounts a ON a.id=t.account_id SET t.revoked_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND t.revoked_at IS NULL');
        $stmt->execute([$user['id']]);
        $stmt = db()->prepare('UPDATE device_codes c JOIN zalo_accounts a ON a.id=c.account_id SET c.used_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND c.used_at IS NULL');
        $stmt->execute([$user['id']]);
        db()->commit();
        $_SESSION['session_version'] = (int)$user['session_version'] + 1;
        reply(['success' => true]);
    }
    if ($action === 'pending-users' && $method === 'GET') {
        $user = current_user(); if ($user['role'] !== 'admin') fail('Chỉ admin được truy cập', 403);
        reply(['users' => db()->query("SELECT id,username,created_at FROM users WHERE approved=0 AND disabled_at IS NULL AND role='user' ORDER BY id")->fetchAll()]);
    }
    if ($action === 'approve-user' && $method === 'POST') {
        $user = current_user(); require_csrf(); if ($user['role'] !== 'admin') fail('Chỉ admin được duyệt', 403);
        $id = (int)(input()['id'] ?? 0);
        db()->beginTransaction();
        $stmt = db()->prepare("UPDATE users SET approved=1,disabled_at=NULL WHERE id=? AND role='user' AND approved=0");
        $stmt->execute([$id]); if (!$stmt->rowCount()) { db()->rollBack(); fail('Không tìm thấy người dùng chờ duyệt', 404); }
        admin_audit((int)$user['id'], 'approve_user', 'user', $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-summary' && $method === 'GET') {
        admin_user();
        $users = db()->query("SELECT COUNT(*) AS total,COALESCE(SUM(approved=0 AND disabled_at IS NULL),0) AS pending,COALESCE(SUM(approved=1 AND disabled_at IS NULL),0) AS active,COALESCE(SUM(disabled_at IS NOT NULL),0) AS disabled FROM users WHERE role='user'")->fetch();
        $accounts = db()->query('SELECT COUNT(*) AS total,COALESCE(SUM(session_cipher IS NOT NULL),0) AS with_session FROM zalo_accounts')->fetch();
        $devices = (int)db()->query('SELECT COUNT(*) FROM device_tokens WHERE revoked_at IS NULL')->fetchColumn();
        reply(['users' => $users, 'accounts' => $accounts, 'active_devices' => $devices]);
    }
    if ($action === 'admin-users' && $method === 'GET') {
        admin_user();
        [$page, $limit, $offset] = admin_page();
        $where = " FROM users u WHERE u.role='user'";
        $params = [];
        $q = trim((string)($_GET['q'] ?? ''));
        if ($q !== '') { $where .= ' AND u.username LIKE ?'; $params[] = '%' . mb_substr($q, 0, 80) . '%'; }
        $status = (string)($_GET['status'] ?? 'all');
        if ($status === 'pending') $where .= ' AND u.approved=0 AND u.disabled_at IS NULL';
        elseif ($status === 'active') $where .= ' AND u.approved=1 AND u.disabled_at IS NULL';
        elseif ($status === 'disabled') $where .= ' AND u.disabled_at IS NOT NULL';
        elseif ($status !== 'all') fail('Bộ lọc trạng thái không hợp lệ');
        $count = db()->prepare('SELECT COUNT(*)' . $where);
        $count->execute($params);
        $stmt = db()->prepare('SELECT u.id,u.username,u.approved,u.disabled_at,u.reset_required,u.created_at,u.last_login_at,u.max_zalo_accounts,u.plan_tier,u.plan_expires_at,
            (SELECT COUNT(*) FROM zalo_accounts a WHERE a.owner_id=u.id) AS account_count,
            (SELECT COUNT(*) FROM zalo_accounts a WHERE a.owner_id=u.id AND a.session_cipher IS NOT NULL) AS session_count,
            (SELECT COUNT(*) FROM device_tokens t JOIN zalo_accounts a ON a.id=t.account_id WHERE a.owner_id=u.id AND t.revoked_at IS NULL) AS device_count'
            . $where . " ORDER BY u.id DESC LIMIT $limit OFFSET $offset");
        $stmt->execute($params);
        reply(['users' => $stmt->fetchAll(), 'total' => (int)$count->fetchColumn(), 'page' => $page, 'limit' => $limit]);
    }
    if ($action === 'admin-user-detail' && $method === 'GET') {
        admin_user();
        $id = (int)($_GET['id'] ?? 0);
        $stmt = db()->prepare("SELECT id,username,approved,disabled_at,reset_required,created_at,last_login_at,max_zalo_accounts,plan_tier,plan_expires_at FROM users WHERE id=? AND role='user'");
        $stmt->execute([$id]); $target = $stmt->fetch();
        if (!$target) fail('Không tìm thấy người dùng', 404);
        $stmt = db()->prepare('SELECT id,label,zalo_uid,session_cipher IS NOT NULL AS has_session,updated_at,created_at,
            (SELECT COUNT(*) FROM device_tokens t WHERE t.account_id=zalo_accounts.id AND t.revoked_at IS NULL) AS device_count
            FROM zalo_accounts WHERE owner_id=? ORDER BY id DESC LIMIT 100');
        $stmt->execute([$id]);
        reply(['user' => $target, 'accounts' => $stmt->fetchAll()]);
    }
    if ($action === 'admin-accounts' && $method === 'GET') {
        admin_user();
        [$page, $limit, $offset] = admin_page();
        $where = ' FROM zalo_accounts a JOIN users u ON u.id=a.owner_id WHERE 1=1';
        $params = [];
        $q = trim((string)($_GET['q'] ?? ''));
        if ($q !== '') { $where .= ' AND (a.label LIKE ? OR u.username LIKE ?)'; $search = '%' . mb_substr($q, 0, 80) . '%'; $params = [$search, $search]; }
        $count = db()->prepare('SELECT COUNT(*)' . $where); $count->execute($params);
        $stmt = db()->prepare('SELECT a.id,a.label,a.zalo_uid,a.session_cipher IS NOT NULL AS has_session,a.updated_at,a.created_at,u.username AS owner,
            (SELECT COUNT(*) FROM device_tokens t WHERE t.account_id=a.id AND t.revoked_at IS NULL) AS device_count'
            . $where . " ORDER BY a.id DESC LIMIT $limit OFFSET $offset");
        $stmt->execute($params);
        reply(['accounts' => $stmt->fetchAll(), 'total' => (int)$count->fetchColumn(), 'page' => $page, 'limit' => $limit]);
    }
    if ($action === 'admin-devices' && $method === 'GET') {
        admin_user();
        $account = admin_account((int)($_GET['account_id'] ?? 0));
        $stmt = db()->prepare('SELECT id,created_at,last_used_at,revoked_at FROM device_tokens WHERE account_id=? ORDER BY id DESC LIMIT 100');
        $stmt->execute([$account['id']]);
        reply(['account' => ['id' => $account['id'], 'label' => $account['label'], 'owner' => $account['owner']], 'devices' => $stmt->fetchAll()]);
    }
    if ($action === 'admin-audit' && $method === 'GET') {
        admin_user();
        [$page, $limit, $offset] = admin_page();
        $stmt = db()->prepare("SELECT l.id,l.action,l.target_type,l.target_id,l.detail,l.created_at,u.username AS actor FROM admin_audit l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT $limit OFFSET $offset");
        $stmt->execute();
        reply(['events' => $stmt->fetchAll(), 'total' => (int)db()->query('SELECT COUNT(*) FROM admin_audit')->fetchColumn(), 'page' => $page, 'limit' => $limit]);
    }
    if ($action === 'admin-set-user-status' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $data = input(); $id = (int)($data['id'] ?? 0);
        if (!is_bool($data['enabled'] ?? null)) fail('Trạng thái không hợp lệ');
        $enabled = $data['enabled'];
        $stmt = db()->prepare("SELECT id,approved,disabled_at FROM users WHERE id=? AND role='user'");
        $stmt->execute([$id]); $target = $stmt->fetch();
        if (!$target || !(int)$target['approved']) fail('Chỉ thay đổi trạng thái người dùng đã được duyệt', 404);
        db()->beginTransaction();
        $stmt = db()->prepare('UPDATE users SET disabled_at=' . ($enabled ? 'NULL' : 'UTC_TIMESTAMP()') . ',session_version=session_version+1 WHERE id=?');
        $stmt->execute([$id]);
        if (!$enabled) {
            $stmt = db()->prepare('UPDATE device_tokens t JOIN zalo_accounts a ON a.id=t.account_id SET t.revoked_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND t.revoked_at IS NULL');
            $stmt->execute([$id]);
            $stmt = db()->prepare('UPDATE device_codes c JOIN zalo_accounts a ON a.id=c.account_id SET c.used_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND c.used_at IS NULL');
            $stmt->execute([$id]);
        }
        admin_audit((int)$actor['id'], $enabled ? 'enable_user' : 'disable_user', 'user', $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-reject-user' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $id = (int)(input()['id'] ?? 0);
        db()->beginTransaction();
        $stmt = db()->prepare("UPDATE users SET disabled_at=UTC_TIMESTAMP(),session_version=session_version+1 WHERE id=? AND role='user' AND approved=0 AND disabled_at IS NULL");
        $stmt->execute([$id]); if (!$stmt->rowCount()) { db()->rollBack(); fail('Không tìm thấy đăng ký chờ duyệt', 404); }
        admin_audit((int)$actor['id'], 'reject_user', 'user', $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-reset-password' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $data = input();
        $id = (int)($data['id'] ?? 0);
        $mode = (string)($data['mode'] ?? 'auto');
        $customPassword = (string)($data['password'] ?? '');
        $requireReset = !empty($data['require_reset']) ? 1 : 0;

        if ($mode === 'custom' || $customPassword !== '') {
            if (strlen($customPassword) < 12) fail('Mật khẩu mới cần ít nhất 12 ký tự');
            $password = $customPassword;
            $auditDetail = 'Tự đặt mật khẩu';
        } else {
            $password = bin2hex(random_bytes(12));
            $requireReset = 1;
            $auditDetail = 'Tự động tạo mật khẩu';
        }

        db()->beginTransaction();
        $stmt = db()->prepare("UPDATE users SET password_hash=?,reset_required=?,session_version=session_version+1 WHERE id=? AND role='user' AND approved=1");
        $stmt->execute([password_hash($password, PASSWORD_DEFAULT), $requireReset, $id]);
        if (!$stmt->rowCount()) { db()->rollBack(); fail('Không tìm thấy người dùng đã duyệt', 404); }
        $stmt = db()->prepare('UPDATE device_tokens t JOIN zalo_accounts a ON a.id=t.account_id SET t.revoked_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND t.revoked_at IS NULL');
        $stmt->execute([$id]);
        $stmt = db()->prepare('UPDATE device_codes c JOIN zalo_accounts a ON a.id=c.account_id SET c.used_at=UTC_TIMESTAMP() WHERE a.owner_id=? AND c.used_at IS NULL');
        $stmt->execute([$id]);
        admin_audit((int)$actor['id'], 'reset_password', 'user', $id, $auditDetail);
        db()->commit();
        reply(['temporary_password' => $password, 'mode' => $mode === 'custom' || $customPassword !== '' ? 'custom' : 'auto', 'reset_required' => $requireReset]);
    }
    if ($action === 'admin-revoke-device' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $id = (int)(input()['id'] ?? 0);
        db()->beginTransaction();
        $stmt = db()->prepare('SELECT account_id FROM device_tokens WHERE id=? AND revoked_at IS NULL');
        $stmt->execute([$id]); $accountId = $stmt->fetchColumn();
        if (!$accountId) { db()->rollBack(); fail('Thiết bị không còn hoạt động', 404); }
        $stmt = db()->prepare('UPDATE device_tokens SET revoked_at=UTC_TIMESTAMP() WHERE id=? AND revoked_at IS NULL');
        $stmt->execute([$id]);
        admin_audit((int)$actor['id'], 'revoke_device', 'account', (int)$accountId, 'device_id=' . $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-revoke-all-devices' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $id = (int)(input()['account_id'] ?? 0);
        admin_account($id);
        db()->beginTransaction();
        $stmt = db()->prepare('UPDATE device_tokens SET revoked_at=UTC_TIMESTAMP() WHERE account_id=? AND revoked_at IS NULL');
        $stmt->execute([$id]);
        $stmt = db()->prepare('UPDATE device_codes SET used_at=UTC_TIMESTAMP() WHERE account_id=? AND used_at IS NULL');
        $stmt->execute([$id]);
        admin_audit((int)$actor['id'], 'revoke_all_devices', 'account', $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-clear-session' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $id = (int)(input()['account_id'] ?? 0);
        admin_account($id);
        db()->beginTransaction();
        $stmt = db()->prepare('UPDATE zalo_accounts SET session_cipher=NULL,updated_at=UTC_TIMESTAMP() WHERE id=?');
        $stmt->execute([$id]);
        $stmt = db()->prepare('UPDATE device_tokens SET revoked_at=UTC_TIMESTAMP() WHERE account_id=? AND revoked_at IS NULL');
        $stmt->execute([$id]);
        $stmt = db()->prepare('UPDATE device_codes SET used_at=UTC_TIMESTAMP() WHERE account_id=? AND used_at IS NULL');
        $stmt->execute([$id]);
        admin_audit((int)$actor['id'], 'clear_session', 'account', $id);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'admin-set-user-plan' && $method === 'POST') {
        $actor = admin_user(); require_csrf();
        $data = input();
        $id = (int)($data['id'] ?? 0);
        $maxAccounts = max(1, min(1000, (int)($data['max_zalo_accounts'] ?? 2)));
        $planTier = strtolower(trim((string)($data['plan_tier'] ?? 'free')));
        if (!preg_match('/^[a-z0-9_-]{1,32}$/', $planTier)) $planTier = 'free';
        $expiresRaw = trim((string)($data['plan_expires_at'] ?? ''));
        $expiresAt = null;
        if ($expiresRaw !== '') {
            $ts = strtotime($expiresRaw);
            if ($ts === false) fail('Ngày hết hạn không hợp lệ');
            $expiresAt = date('Y-m-d H:i:s', $ts);
        }
        db()->beginTransaction();
        $stmt = db()->prepare("UPDATE users SET max_zalo_accounts=?,plan_tier=?,plan_expires_at=? WHERE id=? AND role='user' AND approved=1");
        $stmt->execute([$maxAccounts, $planTier, $expiresAt, $id]);
        if (!$stmt->rowCount()) {
            $check = db()->prepare("SELECT id FROM users WHERE id=? AND role='user' AND approved=1");
            $check->execute([$id]);
            if (!$check->fetch()) { db()->rollBack(); fail('Không tìm thấy người dùng đã duyệt', 404); }
        }
        admin_audit((int)$actor['id'], 'update_user_plan', 'user', $id, "max={$maxAccounts}, tier={$planTier}" . ($expiresAt ? ", exp={$expiresAt}" : ''));
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'accounts' && $method === 'GET') {
        $user = current_user();
        $stmt = db()->prepare('SELECT id,label,updated_at,session_cipher IS NOT NULL AS has_session FROM zalo_accounts WHERE owner_id=? ORDER BY id DESC');
        $stmt->execute([$user['id']]);
        $accounts = $stmt->fetchAll();
        $maxAllowed = max(1, (int)($user['max_zalo_accounts'] ?? 2));
        reply([
            'accounts' => $accounts,
            'plan' => [
                'tier' => (string)($user['plan_tier'] ?? 'free'),
                'max_accounts' => $maxAllowed,
                'current_accounts' => count($accounts),
                'expires_at' => $user['plan_expires_at'] ?? null,
                'can_create' => count($accounts) < $maxAllowed,
            ]
        ]);
    }
    if ($action === 'create-account' && $method === 'POST') {
        $user = current_user(); require_csrf();
        $label = trim((string)(input()['label'] ?? ''));
        if ($label === '' || mb_strlen($label) > 100) fail('Tên tài khoản Zalo không hợp lệ');
        $countStmt = db()->prepare('SELECT COUNT(*) FROM zalo_accounts WHERE owner_id=?');
        $countStmt->execute([$user['id']]);
        $currentCount = (int)$countStmt->fetchColumn();
        $maxAllowed = max(1, (int)($user['max_zalo_accounts'] ?? 2));
        if ($currentCount >= $maxAllowed) {
            fail("Bạn đã đạt giới hạn tối đa {$maxAllowed} tài khoản Zalo của gói hiện tại. Vui lòng nâng cấp gói để thêm tài khoản.", 403);
        }
        $stmt = db()->prepare('INSERT INTO zalo_accounts (owner_id,label) VALUES (?,?)');
        $stmt->execute([$user['id'], $label]); reply(['id' => db()->lastInsertId(), 'label' => $label]);
    }
    if ($action === 'device-code' && $method === 'POST') {
        $user = current_user(); require_csrf();
        $account = owned_account((int)(input()['account_id'] ?? 0), (int)$user['id']);
        $code = strtoupper(bin2hex(random_bytes(6)));
        $stmt = db()->prepare('INSERT INTO device_codes (account_id,code_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))');
        $stmt->execute([$account['id'], hash('sha256', $code)]);
        reply(['code' => $code, 'expires_in' => 600]);
    }
    if ($action === 'revoke-devices' && $method === 'POST') {
        $user = current_user(); require_csrf();
        $account = owned_account((int)(input()['account_id'] ?? 0), (int)$user['id']);
        db()->beginTransaction();
        $stmt = db()->prepare('UPDATE device_tokens SET revoked_at=UTC_TIMESTAMP() WHERE account_id=? AND revoked_at IS NULL');
        $stmt->execute([$account['id']]);
        $stmt = db()->prepare('UPDATE device_codes SET used_at=UTC_TIMESTAMP() WHERE account_id=? AND used_at IS NULL');
        $stmt->execute([$account['id']]);
        db()->commit(); reply(['success' => true]);
    }
    if ($action === 'device-pair' && $method === 'POST') {
        $code = strtoupper(trim((string)(input()['code'] ?? '')));
        if (!preg_match('/^[A-F0-9]{12}$/', $code)) fail('Mã ghép nối không hợp lệ');
        db()->beginTransaction();
        $stmt = db()->prepare('SELECT c.id,c.account_id FROM device_codes c JOIN zalo_accounts a ON a.id=c.account_id JOIN users u ON u.id=a.owner_id WHERE c.code_hash=? AND c.used_at IS NULL AND c.expires_at > UTC_TIMESTAMP() AND u.approved=1 AND u.disabled_at IS NULL AND u.reset_required=0 FOR UPDATE');
        $stmt->execute([hash('sha256', $code)]); $row = $stmt->fetch();
        if (!$row) { db()->rollBack(); fail('Mã hết hạn hoặc đã sử dụng', 401); }
        $token = bin2hex(random_bytes(32));
        $stmt = db()->prepare('INSERT INTO device_tokens (account_id,token_hash) VALUES (?,?)');
        $stmt->execute([$row['account_id'], hash('sha256', hex2bin($token))]);
        $stmt = db()->prepare('UPDATE device_codes SET used_at=UTC_TIMESTAMP() WHERE id=?');
        $stmt->execute([$row['id']]); db()->commit();
        reply(['token' => $token]);
    }
    if ($action === 'device-status' && $method === 'GET') {
        $account = device_account(); reply(['id' => $account['id'], 'label' => $account['label'], 'has_session' => $account['session_cipher'] !== null]);
    }
    if ($action === 'device-revoke' && $method === 'POST') {
        device_account();
        preg_match('/^Bearer ([a-f0-9]{64})$/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $match);
        $stmt = db()->prepare('UPDATE device_tokens SET revoked_at=UTC_TIMESTAMP() WHERE token_hash=? AND revoked_at IS NULL');
        $stmt->execute([hash('sha256', hex2bin($match[1]))]);
        reply(['success' => true]);
    }
    if ($action === 'device-session') {
        $account = device_account();
        if ($method === 'GET') reply(['session' => $account['session_cipher'] ? decrypt_session($account['session_cipher'], (int)$account['id']) : null]);
        if ($method === 'PUT') {
            $session = input()['session'] ?? null;
            if (!is_array($session) || !is_string($session['imei'] ?? null) || !is_array($session['cookie'] ?? null)) fail('Phiên Zalo không hợp lệ');
            $uid = trim((string)($session['userInfo']['userId'] ?? ''));
            if ($uid !== '' && !preg_match('/^[0-9]{1,40}$/', $uid)) fail('ID Zalo không hợp lệ');
            $cipher = encrypt_session($session, (int)$account['id']);
            $uidValue = $uid === '' ? null : $uid;
            $stmt = db()->prepare('UPDATE zalo_accounts SET session_cipher=?,zalo_uid=COALESCE(zalo_uid, ?),updated_at=UTC_TIMESTAMP() WHERE id=? AND (zalo_uid IS NULL OR zalo_uid=?)');
            $stmt->execute([$cipher, $uidValue, $account['id'], $uidValue]);
            if (!$stmt->rowCount()) fail('Phiên thuộc tài khoản Zalo khác', 409);
            reply(['success' => true]);
        }
        if ($method === 'DELETE') {
            $stmt = db()->prepare('UPDATE zalo_accounts SET session_cipher=NULL,updated_at=UTC_TIMESTAMP() WHERE id=?');
            $stmt->execute([$account['id']]); reply(['success' => true]);
        }
    }
    fail('API không tồn tại', 404);
} catch (Throwable $e) {
    error_log('NHITZalo PHP: ' . $e->getMessage());
    fail('Lỗi máy chủ; xem PHP error log', 500);
}
