const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../web-php/public/api.php'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../web-php/schema.sql'), 'utf8');
const bootstrap = fs.readFileSync(path.join(__dirname, '../web-php/bootstrap.php'), 'utf8');

test('admin management routes require the administrator role and mutations require CSRF', () => {
  assert.match(api, /function admin_user\(\): array[\s\S]*?role[^\n]*admin/);
  for (const action of ['admin-summary', 'admin-users', 'admin-user-detail', 'admin-accounts', 'admin-devices', 'admin-audit']) {
    assert.match(api, new RegExp(`action === '${action}'[\\s\\S]{0,180}admin_user\\(\\)`));
  }
  for (const action of ['admin-set-user-status', 'admin-reset-password', 'admin-set-user-plan', 'admin-revoke-device', 'admin-revoke-all-devices', 'admin-clear-session']) {
    assert.match(api, new RegExp(`action === '${action}'[\\s\\S]{0,220}admin_user\\(\\)[\\s\\S]{0,100}require_csrf\\(\\)`));
  }
});

test('disabled users lose browser and device access and existing databases migrate safely', () => {
  assert.match(api, /function current_user\([\s\S]*?disabled_at/);
  assert.match(api, /function device_account\([\s\S]*?disabled_at IS NULL/);
  assert.match(api, /action === 'desktop-login'[\s\S]*?disabled_at/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_audit/);
  assert.match(schema, /session_version/);
  assert.match(schema, /max_zalo_accounts/);
  assert.match(bootstrap, /'disabled_at' => 'DATETIME NULL'/);
  assert.match(bootstrap, /'max_zalo_accounts' => 'INT UNSIGNED NOT NULL DEFAULT 2'/);
  assert.match(bootstrap, /SHOW COLUMNS FROM users LIKE '\$name'/);
});
