const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSessionStore = require('../src/web/sessionStore');

test('web Zalo sessions are encrypted at rest and reopen with the admin password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-'));
  const store = new WebSessionStore(dir, 'a-long-admin-password');
  const account = store.createAccount('Tài khoản chính');
  store.saveSession(account.id, { imei: 'imei-1', cookie: [{ key: 'secret-cookie' }], userAgent: 'agent' });
  const raw = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
  assert.doesNotMatch(raw, /secret-cookie|imei-1/);
  assert.equal(JSON.parse(raw).accounts[0].session, undefined);
  const sessionFile = path.join(dir, 'sessions', `${account.id}.json`);
  assert.equal(fs.existsSync(sessionFile), true);
  assert.doesNotMatch(fs.readFileSync(sessionFile, 'utf8'), /secret-cookie|imei-1/);
  const reopened = new WebSessionStore(dir, 'a-long-admin-password');
  assert.equal(reopened.listAccounts()[0].hasSession, true);
  assert.equal(reopened.loadSession(account.id).cookie[0].key, 'secret-cookie');
  assert.throws(() => new WebSessionStore(dir, 'incorrect-password'), /mật khẩu/i);
});

test('old combined account file migrates encrypted sessions into separate files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-'));
  const store = new WebSessionStore(dir, 'a-long-admin-password');
  const account = store.createAccount('Tài khoản cũ');
  store.saveSession(account.id, { imei: 'old-imei', cookie: [{ key: 'old-secret' }] });
  const sessionFile = path.join(dir, 'sessions', `${account.id}.json`);
  const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
  legacy.version = 1;
  legacy.accounts[0].session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  fs.unlinkSync(sessionFile);
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify(legacy));

  const migrated = new WebSessionStore(dir, 'a-long-admin-password');
  assert.equal(migrated.loadSession(account.id).cookie[0].key, 'old-secret');
  assert.equal(fs.existsSync(sessionFile), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).version, 2);
});

test('removing a web session leaves the account while deleting the account removes both', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-'));
  const store = new WebSessionStore(dir, 'a-long-admin-password');
  const account = store.createAccount('Tài khoản phụ');
  store.saveSession(account.id, { imei: 'x', cookie: [] });
  store.removeSession(account.id);
  assert.equal(store.loadSession(account.id), null);
  assert.equal(store.listAccounts().length, 1);
  store.deleteAccount(account.id);
  assert.equal(store.listAccounts().length, 0);
});

test('each web account has an independent encrypted session file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-'));
  const store = new WebSessionStore(dir, 'a-long-admin-password');
  const first = store.createAccount('A');
  const second = store.createAccount('B');
  store.saveSession(first.id, { imei: 'imei-A', cookie: [] });
  store.saveSession(second.id, { imei: 'imei-B', cookie: [] });
  const firstPath = path.join(dir, 'sessions', `${first.id}.json`);
  const secondPath = path.join(dir, 'sessions', `${second.id}.json`);
  assert.notEqual(fs.readFileSync(firstPath, 'utf8'), fs.readFileSync(secondPath, 'utf8'));
  store.removeSession(first.id);
  assert.equal(fs.existsSync(firstPath), false);
  assert.equal(store.loadSession(second.id).imei, 'imei-B');
});
