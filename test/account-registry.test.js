const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AccountRegistry = require('../src/main/accountRegistry');
const MessageStore = require('../src/main/messageStore');

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-accounts-'));

test('each account has a separate directory and only a password hash is persisted', () => {
  const root = tempRoot();
  const registry = new AccountRegistry(root);
  const first = registry.create('Tài khoản A', 'secret-one');
  const second = registry.create('Tài khoản B', 'secret-two');
  assert.notEqual(registry.dataDir(first.id), registry.dataDir(second.id));
  assert.equal(registry.verify(first.id, 'secret-one').id, first.id);
  assert.equal(registry.verify(first.id, 'secret-two'), null);
  assert.equal(registry.list().length, 2);
  assert.equal(fs.readFileSync(path.join(root, 'accounts.json'), 'utf8').includes('secret-one'), false);
});

test('existing single-account files migrate into a locked legacy account', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'zalo_session.json'), 'session');
  fs.writeFileSync(path.join(root, 'zalo_messages.sqlite'), 'history');
  fs.writeFileSync(path.join(root, 'zalo_friends.json'), 'friends');
  const registry = new AccountRegistry(root);
  const legacy = registry.list()[0];
  assert.equal(legacy.needsPassword, true);
  assert.equal(registry.verify(legacy.id, 'anything'), null);
  registry.setInitialPassword(legacy.id, 'new-secret');
  assert.equal(registry.verify(legacy.id, 'new-secret').id, legacy.id);
  assert.equal(fs.readFileSync(path.join(registry.dataDir(legacy.id), 'zalo_messages.sqlite'), 'utf8'), 'history');
  assert.equal(fs.existsSync(path.join(root, 'zalo_friends.json')), false);
});

test('changing a password invalidates the old password', () => {
  const registry = new AccountRegistry(tempRoot());
  const account = registry.create('A', 'before-pass');
  assert.equal(registry.changePassword(account.id, 'bad-pass', 'after-pass'), false);
  assert.equal(registry.changePassword(account.id, 'before-pass', 'after-pass'), true);
  assert.equal(registry.verify(account.id, 'before-pass'), null);
  assert.equal(registry.verify(account.id, 'after-pass').id, account.id);
});

test('a legacy bubble position without Zalo data does not create an account', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'bubble_pos.json'), '{}');
  assert.equal(new AccountRegistry(root).list().length, 0);
});

test('discovers old Zalo data even when a new account was already created', () => {
  const root = tempRoot();
  const first = new AccountRegistry(root);
  first.create('Tài khoản mới', 'new-password');
  fs.writeFileSync(path.join(root, 'zalo_session.json'), 'old-session');
  const registry = new AccountRegistry(root);
  assert.equal(registry.list().length, 2);
  assert.equal(registry.list().filter(account => account.needsPassword).length, 1);
  assert.equal(new AccountRegistry(root).list().length, 2);
});

test('legacy account can migrate and open without a password', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'zalo_messages.sqlite'), 'old-history');
  const registry = new AccountRegistry(root);
  const account = registry.list()[0];
  const opened = registry.openWithoutPassword(account.id);
  assert.equal(opened.requiresPassword, false);
  assert.equal(opened.needsPassword, false);
  assert.equal(registry.verify(account.id, '').id, account.id);
  assert.equal(fs.readFileSync(path.join(registry.dataDir(account.id), 'zalo_messages.sqlite'), 'utf8'), 'old-history');
});

test('new account can be created without a password and protected later', () => {
  const registry = new AccountRegistry(tempRoot());
  const account = registry.create('Công việc', '');
  assert.equal(account.requiresPassword, false);
  assert.equal(registry.verify(account.id, '').id, account.id);
  assert.equal(registry.changePassword(account.id, '', 'new-password'), true);
  assert.equal(registry.verify(account.id, ''), null);
  assert.equal(registry.verify(account.id, 'new-password').id, account.id);
  assert.equal(registry.changePassword(account.id, 'new-password', ''), true);
  assert.equal(registry.verify(account.id, '').id, account.id);
});

test('web profiles are reused by hosting origin and account id', () => {
  const registry = new AccountRegistry(tempRoot());
  const local = registry.create('Cục bộ', '');
  const web = registry.findOrCreateHosted('https://example.com', 42, 'Công việc');
  const same = registry.findOrCreateHosted('https://example.com', 42, 'Công việc mới');
  assert.equal(web.id, same.id);
  assert.equal(same.hosted, true);
  assert.equal(same.name, 'Công việc mới');
  assert.notEqual(web.id, local.id);
  assert.equal(registry.list().length, 2);
});

function seedProfile(registry, account, uid, messageId) {
  const dir = registry.dataDir(account.id);
  fs.writeFileSync(path.join(dir, 'zalo_session.json'), JSON.stringify({ userInfo: { userId: uid, name: 'Mr Hoàng' }, imei: 'test', cookie: [] }));
  const store = new MessageStore(path.join(dir, 'zalo_messages.sqlite'), null);
  store.setOwnPlainId(uid);
  store.put({ id: messageId, threadId: 'thread', timestamp: Number(messageId), content: messageId });
  store.db.close();
}

test('same Zalo identity merges local and hosted history without losing either message', () => {
  const root = tempRoot();
  const registry = new AccountRegistry(root);
  const local = registry.create('Mr Hoàng', '');
  const hosted = registry.findOrCreateHosted('https://example.com', 42, 'Mr Hoàng');
  seedProfile(registry, local, '123456789', '1');
  seedProfile(registry, hosted, '123456789', '2');
  fs.writeFileSync(path.join(registry.dataDir(hosted.id), 'hosted_session_bridge.json'), 'bridge');
  fs.writeFileSync(path.join(registry.dataDir(hosted.id), 'zalo_read.json'), JSON.stringify({ thread: 20 }));
  fs.writeFileSync(path.join(registry.dataDir(local.id), 'zalo_read.json'), JSON.stringify({ thread: 10, other: 5 }));

  assert.equal(registry.consolidateSameZaloProfiles(), 1);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].id, local.id);
  assert.equal(registry.list()[0].hosted, true);
  const merged = new MessageStore(path.join(registry.dataDir(local.id), 'zalo_messages.sqlite'), null);
  assert.equal(merged.getStats().totalMessages, 2);
  merged.db.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(registry.dataDir(local.id), 'zalo_read.json'), 'utf8')), { thread: 20, other: 5 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(registry.dataDir(local.id), 'zalo_read.json.pre-merge'), 'utf8')), { thread: 10, other: 5 });
  assert.equal(fs.readFileSync(path.join(registry.dataDir(local.id), 'hosted_session_bridge.json'), 'utf8'), 'bridge');
  assert.equal(fs.existsSync(path.join(root, 'merged-accounts', hosted.id, 'zalo_messages.sqlite')), true);
  assert.equal(new AccountRegistry(root).list().length, 1);
});

test('matching display names never merge different Zalo identities', () => {
  const registry = new AccountRegistry(tempRoot());
  const first = registry.create('Mr Hoàng', '');
  const second = registry.create('Mr Hoàng', '');
  seedProfile(registry, first, '123456789', '1');
  seedProfile(registry, second, '987654321', '2');
  assert.equal(registry.consolidateSameZaloProfiles(), 0);
  assert.equal(registry.list().length, 2);
});

test('web login reuses a local profile when the remote session belongs to the same Zalo ID', () => {
  const registry = new AccountRegistry(tempRoot());
  const local = registry.create('Mr Hoàng', '');
  seedProfile(registry, local, '123456789', '1');
  const linked = registry.findOrCreateHosted('https://example.com', 42, 'Mr Hoàng', '123456789');
  assert.equal(linked.id, local.id);
  assert.equal(registry.list().length, 1);
  assert.equal(linked.hosted, true);
});

test('an unreadable encrypted session cannot be merged from store metadata alone', () => {
  const registry = new AccountRegistry(tempRoot());
  const first = registry.create('Mr Hoàng', '');
  const second = registry.create('Mr Hoàng', '');
  seedProfile(registry, first, '123456789', '1');
  seedProfile(registry, second, '123456789', '2');
  fs.writeFileSync(path.join(registry.dataDir(second.id), 'zalo_session.json'),
    JSON.stringify({ version: 2, ciphertext: 'unreadable' }));
  assert.equal(registry.consolidateSameZaloProfiles(), 0);
  assert.equal(registry.list().length, 2);
});

test('encrypted sessions can be matched through OS safeStorage', () => {
  const registry = new AccountRegistry(tempRoot());
  const first = registry.create('Local', '');
  const second = registry.findOrCreateHosted('https://example.com', 9, 'Remote');
  seedProfile(registry, first, '123456789', '1');
  seedProfile(registry, second, '123456789', '2');
  for (const account of [first, second]) {
    fs.writeFileSync(path.join(registry.dataDir(account.id), 'zalo_session.json'),
      JSON.stringify({ version: 2, ciphertext: Buffer.from('cipher').toString('base64') }));
  }
  const safeStorage = { isEncryptionAvailable: () => true,
    decryptString: () => JSON.stringify({ userInfo: { userId: '123456789', name: 'Mr Hoàng' } }) };
  assert.equal(registry.consolidateSameZaloProfiles(safeStorage), 1);
  assert.equal(registry.list().length, 1);
});

test('removing a local profile deletes its local data and keeps other profiles', () => {
  const root = tempRoot();
  const registry = new AccountRegistry(root);
  const first = registry.create('Xóa tôi', '');
  const second = registry.create('Giữ lại', '');
  fs.writeFileSync(path.join(registry.dataDir(first.id), 'zalo_session.json'), 'private session');
  assert.equal(registry.remove(first.id, ''), true);
  assert.equal(fs.existsSync(path.join(root, 'accounts', first.id)), false);
  assert.deepEqual(registry.list().map(account => account.id), [second.id]);
  assert.deepEqual(new AccountRegistry(root).list().map(account => account.id), [second.id]);
});

test('protected profile requires its password before local removal', () => {
  const registry = new AccountRegistry(tempRoot());
  const account = registry.create('Bảo vệ', 'correct-password');
  assert.throws(() => registry.remove(account.id, 'wrong-password'), /Mật khẩu không đúng/);
  assert.equal(registry.list().length, 1);
  assert.equal(fs.existsSync(registry.dataDir(account.id)), true);
  assert.equal(registry.remove(account.id, 'correct-password'), true);
  assert.equal(registry.list().length, 0);
});

test('removing a hosted profile only removes its local copy', () => {
  const registry = new AccountRegistry(tempRoot());
  const account = registry.findOrCreateHosted('https://example.com', 42, 'Trên web');
  fs.writeFileSync(path.join(registry.dataDir(account.id), 'hosted_session_bridge.json'), 'local token');
  assert.equal(registry.remove(account.id, ''), true);
  assert.equal(registry.list().length, 0);
  assert.equal(fs.existsSync(path.join(registry.root, 'accounts', account.id)), false);
});

test('legacy profile removal clears the root-level session files', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'zalo_session.json'), 'old session');
  const registry = new AccountRegistry(root);
  const account = registry.list()[0];
  fs.mkdirSync(registry.dataDir(account.id), { recursive: true });
  fs.writeFileSync(path.join(registry.dataDir(account.id), 'zalo_session.json'), 'duplicate session');
  assert.equal(registry.remove(account.id, ''), true);
  assert.equal(fs.existsSync(path.join(root, 'zalo_session.json')), false);
  assert.equal(new AccountRegistry(root).list().length, 0);
});
