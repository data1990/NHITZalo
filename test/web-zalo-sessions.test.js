const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSessionStore = require('../src/web/sessionStore');
const WebZaloSessions = require('../src/web/zaloSessions');

test('QR login saves credentials only after Zalo confirms login and never returns them in status', async () => {
  const store = new WebSessionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-')), 'a-long-admin-password');
  const account = store.createAccount('Test');
  let callback;
  let complete;
  const zalo = { loginQR: (options, cb) => {
    callback = cb;
    return new Promise(resolve => { complete = resolve; });
  } };
  const sessions = new WebZaloSessions(store, () => zalo);
  await sessions.startQR(account.id);
  await Promise.resolve();
  callback({ type: 0, data: { image: 'data:image/png;base64,abc' }, actions: {} });
  assert.equal((await sessions.getStatus(account.id)).status, 'qr_ready');
  assert.equal(store.loadSession(account.id), null);
  callback({ type: 4, data: { imei: 'imei', cookie: [{ key: 'secret-cookie' }], userAgent: 'agent' } });
  complete({ fetchAccountInfo: async () => ({ displayName: 'Nguyễn A' }) });
  await sessions.whenIdle(account.id);
  assert.equal(store.loadSession(account.id).userInfo.name, 'Nguyễn A');
  assert.equal((await sessions.getStatus(account.id)).status, 'connected');
  assert.doesNotMatch(JSON.stringify(await sessions.getStatus(account.id)), /secret-cookie|imei/);
});

test('saved web session is reconnected on startup', async () => {
  const store = new WebSessionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-')), 'a-long-admin-password');
  const account = store.createAccount('Test');
  store.saveSession(account.id, { imei: 'imei', cookie: [], userAgent: 'agent', userInfo: { name: 'A' } });
  let credentials;
  const sessions = new WebZaloSessions(store, () => ({ login: async value => {
    credentials = value;
    return { fetchAccountInfo: async () => ({ displayName: 'A' }) };
  } }));
  await sessions.resumeAll();
  assert.equal(credentials.imei, 'imei');
  assert.equal((await sessions.getStatus(account.id)).status, 'connected');
  await sessions.removeSession(account.id);
  assert.equal(store.loadSession(account.id), null);
});

test('web Zalo sessions wait for asynchronous database writes before reporting connected', async () => {
  const files = new WebSessionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-web-')), 'a-long-admin-password');
  const account = files.createAccount('Database');
  let releaseWrite;
  const store = {
    find: async id => files.find(id),
    loadSession: async id => files.loadSession(id),
    saveSession: async (id, session) => {
      await new Promise(resolve => { releaseWrite = resolve; });
      files.saveSession(id, session);
    }
  };
  let callback;
  let complete;
  const sessions = new WebZaloSessions(store, () => ({ loginQR: (options, cb) => {
    callback = cb;
    return new Promise(resolve => { complete = resolve; });
  } }));
  await sessions.startQR(account.id);
  await Promise.resolve();
  callback({ type: 4, data: { imei: 'db-imei', cookie: [] } });
  complete({ fetchAccountInfo: async () => ({ displayName: 'Database' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual((await sessions.getStatus(account.id)).status, 'connected');
  releaseWrite();
  await sessions.whenIdle(account.id);
  assert.equal((await sessions.getStatus(account.id)).status, 'connected');
  assert.equal(files.loadSession(account.id).imei, 'db-imei');
});
