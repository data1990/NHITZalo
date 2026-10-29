const test = require('node:test');
const assert = require('node:assert/strict');
const { requestQuickLock } = require('../src/main/quickLock');

test('quick lock requires a password and only then starts the lock transition', () => {
  let restarts = 0;
  assert.deepEqual(requestQuickLock({ requiresPassword: false }, () => { restarts++; }),
    { success: false, needsPassword: true });
  assert.equal(restarts, 0);
  assert.deepEqual(requestQuickLock({ requiresPassword: true }, () => { restarts++; }),
    { success: true });
  assert.equal(restarts, 1);
});
