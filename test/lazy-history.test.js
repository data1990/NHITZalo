const test = require('node:test');
const assert = require('node:assert/strict');
const { getVirtualRange, retainActiveThreadMessages, mergeIncomingHistory } = require('../src/renderer/dashboard/lazyHistory');

test('conversation list renders a small moving window across a large history', () => {
  const top = getVirtualRange(1500, 0, 700, 70, 8);
  assert.deepEqual(top, { start: 0, end: 18, top: 0, bottom: 103740 });
  const middle = getVirtualRange(1500, 70000, 700, 70, 8);
  assert.equal(middle.start, 992);
  assert.equal(middle.end, 1018);
  assert.equal(middle.top, 992 * 70);
  assert.equal(middle.bottom, (1500 - 1018) * 70);
});

test('switching chats retains one head per other chat and active chat detail', () => {
  const messages = [
    { id: 'a1', threadId: 'a', timestamp: 1 },
    { id: 'a2', threadId: 'a', timestamp: 2 },
    { id: 'b1', threadId: 'b', timestamp: 3 },
    { id: 'b2', threadId: 'b', timestamp: 4 },
    { id: 'b3', threadId: 'b', timestamp: 5 }
  ];
  const result = retainActiveThreadMessages(messages, 'a');
  assert.deepEqual(result.map(message => message.id), ['b3', 'a2', 'a1']);
});

test('batched old messages keep active detail and only the latest inactive head', () => {
  const current = [
    { id: 'a1', threadId: 'a', timestamp: 10 },
    { id: 'b1', threadId: 'b', timestamp: 20 }
  ];
  const incoming = [
    { id: 'a2', threadId: 'a', timestamp: 11 },
    { id: 'b0', threadId: 'b', timestamp: 19 },
    { id: 'a2', threadId: 'a', timestamp: 11 }
  ];
  assert.deepEqual(mergeIncomingHistory(current, incoming, 'a').map(message => message.id), ['b1', 'a2', 'a1']);
});
