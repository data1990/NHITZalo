const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AccountRegistry = require('../src/main/accountRegistry');

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-account-name-'));
const storage = {
  isEncryptionAvailable: () => true,
  decryptString: bytes => bytes.toString('utf8')
};

test('legacy account shows Zalo display name from its encrypted saved session before unlock', () => {
  const root = tempRoot();
  const payload = { imei: 'private-imei', cookie: 'private-cookie', userInfo: { name: 'Minh Zalo' } };
  fs.writeFileSync(path.join(root, 'zalo_session.json'), JSON.stringify({ version: 2,
    ciphertext: Buffer.from(JSON.stringify(payload)).toString('base64') }));
  const registry = new AccountRegistry(root);
  assert.equal(registry.list()[0].name, 'Tài khoản Zalo hiện tại');
  registry.refreshZaloNames(storage);
  assert.equal(registry.list()[0].name, 'Minh Zalo');
  const saved = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8');
  assert.equal(saved.includes('private-cookie'), false);
  assert.equal(new AccountRegistry(root).list()[0].name, 'Minh Zalo');
});

test('Zalo name from an account session replaces the local account label in the picker', () => {
  const root = tempRoot();
  const registry = new AccountRegistry(root);
  const account = registry.create('Công việc', 'password-123');
  const payload = { userInfo: { name: 'Lan Nguyễn' } };
  fs.writeFileSync(path.join(registry.dataDir(account.id), 'zalo_session.json'), JSON.stringify({ version: 2,
    ciphertext: Buffer.from(JSON.stringify(payload)).toString('base64') }));
  registry.refreshZaloNames(storage);
  assert.equal(registry.list()[0].name, 'Lan Nguyễn');
});

test('unreadable saved session keeps the existing account name', () => {
  const root = tempRoot();
  const registry = new AccountRegistry(root);
  const account = registry.create('Cá nhân', 'password-123');
  fs.writeFileSync(path.join(registry.dataDir(account.id), 'zalo_session.json'), '{invalid');
  registry.refreshZaloNames(storage);
  assert.equal(registry.list()[0].name, 'Cá nhân');
});
