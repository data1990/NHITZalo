const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const MySqlStore = require('../src/web/mysqlStore');
const WebSessionStore = require('../src/web/sessionStore');
const { createHostedServer } = require('../src/web/hostedServer');

class MemoryPool {
  constructor() { this.meta = null; this.users = []; this.accounts = []; }
  async query(sql) {
    if (sql.startsWith('CREATE TABLE')) return [[], []];
    throw new Error(`Unexpected query: ${sql}`);
  }
  async execute(sql, params = []) {
    if (sql.startsWith('INSERT IGNORE INTO web_meta')) {
      if (!this.meta) this.meta = { salt: params[0], verifier: params[1] };
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT salt, verifier FROM web_meta')) return [[this.meta], []];
    if (sql.startsWith('SELECT id FROM web_users WHERE username')) {
      return [this.users.filter(row => row.username === params[0]).map(row => ({ id: row.id })), []];
    }
    if (sql.startsWith('INSERT INTO web_users')) {
      if (this.users.some(row => row.username === params[1])) {
        const error = new Error('Duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      this.users.push({ id: params[0], username: params[1], password_salt: params[2],
        password_hash: params[3], role: params[4], approved: params[5] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT id, username, password_salt')) {
      return [this.users.filter(row => row.username === params[0]), []];
    }
    if (sql.startsWith('SELECT id, username, role, approved FROM web_users WHERE id')) {
      return [this.users.filter(row => row.id === params[0]), []];
    }
    if (sql.startsWith('SELECT id, username, role, approved FROM web_users WHERE approved')) {
      return [this.users.filter(row => !row.approved && row.role === 'user'), []];
    }
    if (sql.startsWith('UPDATE web_users SET approved')) {
      const user = this.users.find(row => row.id === params[0] && row.role === 'user');
      if (user) user.approved = 1;
      return [{ affectedRows: user ? 1 : 0 }];
    }
    if (sql.startsWith('SELECT id, label, owner_id, session_cipher IS NOT NULL')) {
      return [this.accounts.filter(row => !params.length || row.owner_id === params[0])
        .map(row => ({ id: row.id, label: row.label, ownerId: row.owner_id,
          hasSession: row.session_cipher !== null })), []];
    }
    if (sql.startsWith('SELECT id, label, owner_id FROM web_accounts')) {
      return [this.accounts.filter(row => row.id === params[0]).map(row => ({ id: row.id,
        label: row.label, ownerId: row.owner_id })), []];
    }
    if (sql.startsWith('INSERT INTO web_accounts')) {
      this.accounts.push({ id: params[0], owner_id: params[1], label: params[2], session_cipher: null });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT IGNORE INTO web_accounts')) {
      if (!this.accounts.some(row => row.id === params[0])) {
        this.accounts.push({ id: params[0], owner_id: params[1], label: params[2], session_cipher: null });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE web_accounts SET session_cipher = ?')) {
      const row = this.accounts.find(item => item.id === params[1]);
      if (row) row.session_cipher = params[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('SELECT session_cipher FROM web_accounts')) {
      return [this.accounts.filter(row => row.id === params[0]).map(row => ({ session_cipher: row.session_cipher })), []];
    }
    if (sql.startsWith('UPDATE web_accounts SET session_cipher = NULL')) {
      const row = this.accounts.find(item => item.id === params[0]);
      if (row) row.session_cipher = null;
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('DELETE FROM web_accounts')) {
      const size = this.accounts.length;
      this.accounts = this.accounts.filter(row => row.id !== params[0]);
      return [{ affectedRows: size - this.accounts.length }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

test('MySQL keeps users, approvals and encrypted Zalo sessions across restarts', async () => {
  const pool = new MemoryPool();
  const first = await MySqlStore.open(pool, 'a-long-admin-password');
  const admin = await first.authenticate('admin', 'a-long-admin-password');
  assert.equal(admin.role, 'admin');
  const pending = await first.registerUser('alice', 'alice-password-123');
  assert.equal(pending.approved, false);
  assert.equal((await first.authenticate('alice', 'alice-password-123')).approved, false);
  assert.equal((await first.listPendingUsers()).length, 1);
  await first.approveUser(pending.id);
  const alice = await first.authenticate('alice', 'alice-password-123');
  assert.equal(alice.approved, true);
  const account = await first.createAccount('Zalo Alice', alice.id);
  await first.saveSession(account.id, { imei: 'private-imei', cookie: [{ key: 'private-cookie' }] });
  assert.doesNotMatch(pool.accounts[0].session_cipher, /private-imei|private-cookie/);
  const reopened = await MySqlStore.open(pool, 'a-long-admin-password');
  assert.equal((await reopened.listAccounts(alice.id))[0].hasSession, true);
  assert.equal((await reopened.loadSession(account.id)).cookie[0].key, 'private-cookie');
  assert.equal((await reopened.listAccounts(admin.id)).length, 0);
  await assert.rejects(MySqlStore.open(pool, 'different-admin-password'), /mật khẩu/i);
});

test('old encrypted file sessions migrate into MySQL without losing account IDs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-mysql-migrate-'));
  const old = new WebSessionStore(directory, 'a-long-admin-password');
  const account = old.createAccount('Zalo cũ');
  old.saveSession(account.id, { imei: 'old-imei', cookie: [{ key: 'old-cookie' }] });
  const store = await MySqlStore.open(new MemoryPool(), 'a-long-admin-password');
  await store.importLegacy(directory);
  assert.equal((await store.loadSession(account.id)).cookie[0].key, 'old-cookie');
  assert.equal(fs.existsSync(path.join(directory, 'accounts.json')), false);
  assert.equal(fs.existsSync(path.join(directory, 'accounts.json.migrated')), true);
  await store.importLegacy(directory);
  assert.equal((await store.listAccounts()).length, 1);
});

test('hosted web requires admin approval and limits Zalo accounts to their owner', async t => {
  const store = await MySqlStore.open(new MemoryPool(), 'a-long-admin-password');
  const server = createHostedServer({ store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body, cookie = '', csrf = '') => fetch(`${origin}${route}`, {
    method: 'POST', headers: { origin, cookie, 'x-csrf-token': csrf,
      'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.headers.get('content-type').startsWith('application/json'), true);
  assert.equal((await health.json()).ok, true);

  assert.equal((await post('/api/register', { username: 'alice', password: 'alice-password-123' })).status, 201);
  assert.equal((await post('/api/login', { username: 'alice', password: 'alice-password-123' })).status, 403);
  const adminLogin = await post('/api/login', { username: 'admin', password: 'a-long-admin-password' });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const adminCsrf = (await adminLogin.json()).csrf;
  const pending = await fetch(`${origin}/api/admin/pending`, { headers: { cookie: adminCookie } });
  const pendingUser = (await pending.json()).users[0];
  assert.equal(pendingUser.username, 'alice');
  assert.equal((await post(`/api/admin/users/${pendingUser.id}/approve`, {}, adminCookie, adminCsrf)).status, 200);
  const userLogin = await post('/api/login', { username: 'alice', password: 'alice-password-123' });
  assert.equal(userLogin.status, 200);
  const userCookie = userLogin.headers.get('set-cookie').split(';')[0];
  const userCsrf = (await userLogin.json()).csrf;
  const created = await post('/api/accounts', { label: 'Zalo Alice' }, userCookie, userCsrf);
  assert.equal(created.status, 201);
  const aliceId = (await created.json()).account.id;
  const adminAccount = await post('/api/accounts', { label: 'Zalo Admin' }, adminCookie, adminCsrf);
  const adminId = (await adminAccount.json()).account.id;
  const userList = await fetch(`${origin}/api/accounts`, { headers: { cookie: userCookie } });
  assert.deepEqual((await userList.json()).accounts.map(account => account.id), [aliceId]);
  assert.equal((await post(`/api/accounts/${adminId}/delete`, {}, userCookie, userCsrf)).status, 403);
  assert.equal((await post('/api/admin/users/' + pendingUser.id + '/approve', {}, userCookie, userCsrf)).status, 403);
});
