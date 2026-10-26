const test = require('node:test');
const assert = require('node:assert/strict');
const { setupAccountModal } = require('../src/renderer/dashboard/accountModal');

class FakeElement {
  constructor() { this.listeners = new Map(); this.focused = false; this.resetCount = 0; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  fire(type, event = {}) { return this.listeners.get(type)?.({ target: this, ...event }); }
  focus() { this.focused = true; }
  reset() { this.resetCount += 1; }
}

test('account management opens as a modal and clears password fields when closed', () => {
  const dialog = new FakeElement();
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  const trigger = new FakeElement();
  const close = new FakeElement();
  const form = new FakeElement();
  setupAccountModal({ dialog, trigger, close, form });
  trigger.fire('click');
  assert.equal(dialog.open, true);
  close.fire('click');
  assert.equal(dialog.open, false);
  assert.equal(form.resetCount, 1);
  assert.equal(trigger.focused, true);
});

test('clicking the modal backdrop closes it', () => {
  const dialog = new FakeElement();
  dialog.open = true;
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  const trigger = new FakeElement();
  setupAccountModal({ dialog, trigger, close: new FakeElement(), form: new FakeElement() });
  dialog.fire('click', { target: dialog });
  assert.equal(dialog.open, false);
});
