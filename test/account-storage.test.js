const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountStorage } = require('../src/shared/accountStorage');

test('renderer storage values are scoped to the selected account', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const one = createAccountStorage(storage, 'one');
  const two = createAccountStorage(storage, 'two');
  one.setItem('nhitzalo.pin', 'message-one');
  assert.equal(two.getItem('nhitzalo.pin'), null);
  two.setItem('nhitzalo.pin', 'message-two');
  assert.equal(one.getItem('nhitzalo.pin'), 'message-one');
});

test('legacy profile copies old renderer state into its scoped keys once', () => {
  const values = new Map([['nhitzalo.pin', 'old-pin']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const legacy = createAccountStorage(storage, 'old-account', true);
  assert.equal(legacy.getItem('nhitzalo.pin'), 'old-pin');
  storage.setItem('nhitzalo.pin', 'changed-old-value');
  assert.equal(legacy.getItem('nhitzalo.pin'), 'old-pin');
  assert.equal(createAccountStorage(storage, 'new-account').getItem('nhitzalo.pin'), null);
});
