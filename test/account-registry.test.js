const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AccountRegistry = require('../src/main/accountRegistry');

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
