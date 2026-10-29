const test = require('node:test');
const assert = require('node:assert/strict');
const { isIncomingMessage, countIncomingMessages } = require('../src/shared/unreadMessages');

test('only received messages contribute to unread counts', () => {
  const messages = [
    { id: 'a', isSelf: true, timestamp: 100 },
    { id: 'b', senderName: 'Bạn (Tôi)', timestamp: 200 },
    { id: 'c', senderId: 'self', timestamp: 300 },
    { id: 'd', senderId: '123456789', timestamp: 400 },
    { id: 'e', senderId: '987654321', timestamp: 500 }
  ];
  assert.equal(isIncomingMessage(messages[0]), false);
  assert.equal(isIncomingMessage(messages[1]), false);
  assert.equal(isIncomingMessage(messages[2]), false);
  assert.equal(isIncomingMessage(messages[3]), true);
  assert.equal(countIncomingMessages(messages), 2);
  assert.equal(countIncomingMessages(messages, 450), 1);
});
