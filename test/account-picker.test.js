const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function mountPicker(account, unlock = async () => ({ success: true })) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    focus() {}
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
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/account/app.js'), 'utf8');
  vm.runInNewContext(source, { document, console,
    window: { accounts: { list: async () => [account], unlock } } });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

test('account picker renders each saved account as a selectable button', async () => {
  const elements = await mountPicker({ id: 'old', name: 'Tài khoản cũ', needsPassword: true });
  const buttons = elements.get('account-list').children;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].children[1].children[0].textContent, 'Tài khoản cũ');
});

test('legacy account offers a visible skip button without opening password fields', async () => {
  const calls = [];
  const elements = await mountPicker({ id: 'old', name: 'Mr Hoàng', needsPassword: true },
    async (id, password) => { calls.push([id, password]); return { success: true }; });
  await elements.get('account-list').children[0].click();
  assert.equal(elements.get('unlock-password-wrap').hidden, true);
  assert.equal(elements.get('initial-confirm-wrap').hidden, true);
  await elements.get('btn-skip-password').click();
  assert.deepEqual(calls, [['old', '']]);
});

test('setting a password for legacy data is a separate explicit choice', async () => {
  const elements = await mountPicker({ id: 'old', name: 'Mr Hoàng', needsPassword: true });
  await elements.get('account-list').children[0].click();
  await elements.get('btn-set-password').click();
  assert.equal(elements.get('legacy-choice-actions').hidden, true);
  assert.equal(elements.get('unlock-password-wrap').hidden, false);
  assert.equal(elements.get('initial-confirm-wrap').hidden, false);
  assert.equal(elements.get('unlock-password').required, true);
});
