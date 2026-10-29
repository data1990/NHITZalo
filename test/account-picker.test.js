const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function mountPicker(account, unlock = async () => ({ success: true }), webLogin = async () => ({ success: true }),
  webRegister = async () => ({ success: true, message: 'Đã gửi đăng ký' }),
  remove = async () => ({ success: true }), setPassword = async () => ({ success: true })) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    focus() {}
    scrollIntoView() {}
    setAttribute() {}
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    async click() { return this.listeners.click?.({ currentTarget: this }); }
  }
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() { return new Element(); },
    querySelector() { return new Element(); }
  };
  for (const id of ['register-username', 'register-password', 'register-confirm', 'web-username', 'web-password']) {
    document.getElementById(id);
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/account/app.js'), 'utf8');
  vm.runInNewContext(source, { document, console,
    window: { accounts: { list: async () => [account], unlock, webLogin, webRegister, remove, setPassword } } });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

test('account picker renders each saved account as a selectable button', async () => {
  const elements = await mountPicker({ id: 'old', name: 'Tài khoản cũ', needsPassword: true });
  const rows = elements.get('account-list').children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children[0].children[1].children[0].textContent, 'Tài khoản cũ');
  assert.match(rows[0].children[1].getAttribute?.('aria-label') || rows[0].children[1].title, /Xóa/);
});

test('legacy account offers a visible skip button without opening password fields', async () => {
  const calls = [];
  const elements = await mountPicker({ id: 'old', name: 'Mr Hoàng', needsPassword: true },
    async (id, password) => { calls.push([id, password]); return { success: true }; });
  await elements.get('account-list').children[0].children[0].click();
  assert.equal(elements.get('unlock-password-wrap').hidden, true);
  assert.equal(elements.get('initial-confirm-wrap').hidden, true);
  await elements.get('btn-skip-password').click();
  assert.deepEqual(calls, [['old', '']]);
});

test('setting a password for legacy data is a separate explicit choice', async () => {
  const elements = await mountPicker({ id: 'old', name: 'Mr Hoàng', needsPassword: true });
  await elements.get('account-list').children[0].children[0].click();
  await elements.get('btn-set-password').click();
  assert.equal(elements.get('legacy-choice-actions').hidden, true);
  assert.equal(elements.get('unlock-password-wrap').hidden, false);
  assert.equal(elements.get('initial-confirm-wrap').hidden, false);
  assert.equal(elements.get('unlock-password').required, true);
});

test('an existing password-free account can be protected before opening', async () => {
  const passwords = [];
  const opened = [];
  const elements = await mountPicker({ id: 'local', name: 'Mr Hoàng', needsPassword: false,
    requiresPassword: false, hasSession: true },
  async (id, password) => { opened.push([id, password]); return { success: true }; },
  undefined, undefined, undefined,
  async (id, password) => { passwords.push([id, password]); return { success: true }; });
  await elements.get('account-list').children[0].children[0].click();
  assert.equal(elements.get('legacy-choice-actions').hidden, false);
  await elements.get('btn-set-password').click();
  elements.get('unlock-password').value = 'new-secret';
  elements.get('initial-confirm').value = 'new-secret';
  await elements.get('unlock-form').listeners.submit({ preventDefault() {}, submitter: new (class { constructor() { this.disabled = false; } })() });
  assert.deepEqual(passwords, [['local', 'new-secret']]);
  assert.deepEqual(opened, [['local', 'new-secret']]);
});

test('delete control confirms a local removal and sends the protected account password', async () => {
  const calls = [];
  const elements = await mountPicker({ id: 'old', name: 'Mr Hoàng', requiresPassword: true },
    undefined, undefined, undefined,
    async (id, password) => { calls.push([id, password]); return { success: true }; });
  await elements.get('account-list').children[0].children[1].click();
  assert.equal(elements.get('remove-dialog').open, true);
  assert.equal(elements.get('remove-password-wrap').hidden, false);
  elements.get('remove-password').value = 'account-password';
  await elements.get('remove-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(calls, [['old', 'account-password']]);
  assert.equal(elements.get('remove-dialog').open, false);
});

test('web sign-in lets users choose one of several hosted Zalo accounts', async () => {
  const calls = [];
  const elements = await mountPicker({ id: 'local', name: 'Cục bộ' }, undefined,
    async (username, password, accountId) => {
      calls.push({ username, password, accountId });
      return accountId ? { success: true, account: { id: 9, label: 'Gia đình' } }
        : { success: true, accounts: [{ id: 9, label: 'Gia đình', has_session: 1 }] };
    });
  elements.get('web-username').value = 'member';
  elements.get('web-password').value = 'secret';
  await elements.get('show-web-login').click();
  assert.equal(elements.get('web-panel').hidden, false);
  elements.get('web-form').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('web-account-list').children.length, 1);
  await elements.get('web-account-list').children[0].click();
  assert.equal(calls[1].accountId, 9);
  assert.equal(elements.get('web-password').value, '');
});

test('quick registration reports pending approval and never supplies a website field', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/account/index.html'), 'utf8');
  assert.doesNotMatch(html, /id="web-origin"/);
  assert.match(html, /id="register-form"/);
  const calls = [];
  const elements = await mountPicker({ id: 'local', name: 'Cục bộ' }, undefined, undefined,
    async (username, password) => { calls.push([username, password]); return { success: true, message: 'Đã đăng ký, chờ admin duyệt' }; });
  await elements.get('show-web-register').click();
  elements.get('register-username').value = 'newuser';
  elements.get('register-password').value = 'a-long-password';
  elements.get('register-confirm').value = 'a-long-password';
  elements.get('register-form').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['newuser', 'a-long-password']]);
  assert.match(elements.get('web-success').textContent, /admin duyệt/);
  assert.equal(elements.get('register-password').value, '');
});
