const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function createManager(dataDir, encryptionAvailable = true, accountDir = null) {
  const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: text => Buffer.from(`encrypted:${text}`),
    decryptString: buffer => buffer.toString().slice('encrypted:'.length)
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dataDir }, safeStorage };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    const Manager = require('../src/main/zaloManager');
    return new Manager(undefined, undefined, undefined, undefined, undefined, undefined, accountDir);
  } finally {
    Module._load = originalLoad;
  }
}

test('saved session does not expose cookie text and can be loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-session-'));
  const manager = createManager(dir);
  const session = { imei: 'imei-1', cookie: [{ name: 'secret-cookie', value: 'sensitive' }] };
  manager.saveSession(session);
  const raw = fs.readFileSync(manager.sessionPath, 'utf8');
  assert.equal(raw.includes('secret-cookie'), false);
  assert.deepEqual(manager.loadSession(), session);
});

test('legacy plaintext session is converted after a successful read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-session-'));
  const session = { imei: 'old-imei', cookie: [{ name: 'old-cookie', value: 'sensitive' }] };
  const sessionPath = path.join(dir, 'zalo_session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  const manager = createManager(dir);
  assert.deepEqual(manager.loadSession(), session);
  assert.equal(fs.readFileSync(sessionPath, 'utf8').includes('old-cookie'), false);
});

test('session is not persisted as plaintext when OS encryption is unavailable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-session-'));
  const manager = createManager(dir, false);
  manager.saveSession({ imei: 'i', cookie: 'private' });
  assert.equal(fs.existsSync(manager.sessionPath), false);
});

test('account managers keep sessions and message databases in separate directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-separated-'));
  const first = createManager(root, true, path.join(root, 'accounts', 'one'));
  const second = createManager(root, true, path.join(root, 'accounts', 'two'));
  first.saveSession({ imei: 'one', cookie: 'private-one' });
  assert.equal(second.hasSavedSession(), false);
  assert.notEqual(first.messageStore.dbPath, second.messageStore.dbPath);
  assert.notEqual(first.friendsPath, second.friendsPath);
  assert.notEqual(first.groupsPath, second.groupsPath);
  assert.equal(second.getHistoryMessages().length, 0);
});

test('empty hosted session removes stale local session before auto login', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-hosted-empty-'));
  const manager = createManager(dir);
  manager.saveSession({ imei: 'old', cookie: [{ name: 'sid', value: 'old' }] });
  manager.hostedSessionBridge = { download: async () => null };
  assert.equal(await manager.tryAutoLogin(), false);
  assert.equal(manager.hasSavedSession(), false);
});

test('revoked hosted device cannot fall back to local Zalo session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-hosted-revoked-'));
  const manager = createManager(dir);
  manager.saveSession({ imei: 'old', cookie: [{ name: 'sid', value: 'old' }] });
  manager.hostedSessionBridge = { download: async () => { const error = new Error('Revoked'); error.status = 401; throw error; } };
  assert.equal(await manager.tryAutoLogin(), false);
  assert.equal(manager.hasSavedSession(), false);
});

test('hosting outage does not silently log in with a local copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-hosted-outage-'));
  const manager = createManager(dir);
  manager.saveSession({ imei: 'old', cookie: [{ name: 'sid', value: 'old' }] });
  manager.hostedSessionBridge = { download: async () => { throw new Error('Network unreachable'); } };
  assert.equal(await manager.tryAutoLogin(), false);
  assert.equal(manager.hasSavedSession(), true);
});
