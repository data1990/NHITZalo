const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWebServer, resolveAdminPassword } = require('../src/web/server');

test('Linux service can read the admin password from a systemd credential file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-credential-'));
  fs.writeFileSync(path.join(directory, 'nhitzalo_admin_password'), 'long-secret-from-file\n');
  assert.equal(resolveAdminPassword({ CREDENTIALS_DIRECTORY: directory }), 'long-secret-from-file');
  assert.equal(resolveAdminPassword({ WEB_ADMIN_PASSWORD: 'password-from-host',
    CREDENTIALS_DIRECTORY: directory }), 'password-from-host');
});

test('web host requires admin login and CSRF before managing Zalo accounts', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-http-'));
  const server = createWebServer({ dataDir, password: 'a-long-admin-password' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(`${origin}${route}`, options);

  assert.equal((await request('/api/accounts')).status, 401);
  const login = await request('/api/login', { method: 'POST', headers: { origin,
    'content-type': 'application/json' }, body: JSON.stringify({ password: 'a-long-admin-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await login.json();
  const unauthorized = await request('/api/accounts', { method: 'POST', headers: { origin, cookie,
    'content-type': 'application/json' }, body: JSON.stringify({ label: 'Test' }) });
  assert.equal(unauthorized.status, 403);
  const create = await request('/api/accounts', { method: 'POST', headers: { origin, cookie,
    'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Tài khoản web' }) });
  assert.equal(create.status, 201);
  const list = await request('/api/accounts', { headers: { cookie } });
  const body = await list.text();
  assert.match(body, /Tài khoản web/);
  assert.doesNotMatch(body, /cookie|imei|ciphertext/);
});
