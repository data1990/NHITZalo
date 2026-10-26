const test = require('node:test');
const assert = require('node:assert/strict');
const { createBubbleThreadVisibility } = require('../src/renderer/bubble/bubbleThreadVisibility');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('closing one chat head keeps other conversations visible across reloads', () => {
  const storage = memoryStorage();
  const visibility = createBubbleThreadVisibility(storage);
  visibility.close('person-a');

  assert.equal(visibility.isClosed('person-a'), true);
  assert.equal(visibility.isClosed('person-b'), false);
  assert.deepEqual(
    visibility.visible([{ threadId: 'person-a' }, { threadId: 'person-b' }]).map(t => t.threadId),
    ['person-b']
  );
  assert.equal(createBubbleThreadVisibility(storage).isClosed('person-a'), true);
});

test('only a fresh incoming message reopens a closed chat head', () => {
  const storage = memoryStorage();
  const visibility = createBubbleThreadVisibility(storage);
  visibility.close('person-a');

  assert.equal(visibility.reopenForMessage('person-a', { isOld: true, isSelf: false }), false);
  assert.equal(visibility.reopenForMessage('person-a', { isOld: false, isSelf: true }), false);
  assert.equal(visibility.isClosed('person-a'), true);
  assert.equal(visibility.reopenForMessage('person-a', { isOld: false, isSelf: false }), true);
  assert.equal(visibility.isClosed('person-a'), false);
  assert.equal(createBubbleThreadVisibility(storage).isClosed('person-a'), false);
});
