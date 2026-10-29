const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const MessageStore = require('../src/main/messageStore');
const { normalizeReceipt, promoteDeliveryStatus, deliveryStatusLabel } = require('../src/shared/deliveryStatus');

test('Zalo receipts identify the exact conversation and message', () => {
  assert.deepEqual(normalizeReceipt({ type: 0, threadId: '123456789', data: {
    msgId: '456', realMsgId: '789', deliveredUids: ['123456789']
  } }, 'delivered'), { threadId: '123456789', isGroup: false, messageIds: ['789', '456'], status: 'delivered' });
  assert.equal(normalizeReceipt({ type: 1, threadId: '222222222', isSelf: true,
    data: { msgId: '456', seenUids: ['111111111'] } }, 'seen'), null);
  assert.equal(normalizeReceipt({ type: 1, threadId: '222222222', isSelf: false,
    data: { msgId: '456', seenUids: ['111111111'] } }, 'seen')?.status, 'seen');
});

test('delivery state only advances and leaves received messages unchanged', () => {
  assert.equal(promoteDeliveryStatus('seen', 'delivered'), 'seen');
  assert.equal(promoteDeliveryStatus('sent', 'delivered'), 'delivered');
  assert.equal(deliveryStatusLabel({ isSelf: true, deliveryStatus: 'seen' }), 'Đã xem');
  assert.equal(deliveryStatusLabel({ isSelf: true, id: '123', content: 'Tin cũ' }), 'Đã gửi');
  assert.equal(deliveryStatusLabel({ isSelf: true, isGroup: true, id: '124' }), 'Đã gửi');
  assert.equal(deliveryStatusLabel({ isSelf: false, deliveryStatus: 'seen' }), '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhit-receipt-'));
  const store = new MessageStore(path.join(dir, 'messages.sqlite'));
  try {
    store.putMany([
      { id: '101', cliMsgId: '201', threadId: '123456789', timestamp: 1, isSelf: true, content: 'hello', senderName: 'Bạn (Tôi)' },
      { id: '102', threadId: '123456789', timestamp: 2, isSelf: false, content: 'reply', senderName: 'Bạn' }
    ]);
    assert.equal(store.updateDeliveryStatus('123456789', ['101'], false, 'delivered')?.deliveryStatus, 'delivered');
    assert.equal(store.updateDeliveryStatus('123456789', ['201'], false, 'seen')?.deliveryStatus, 'seen');
    assert.equal(store.updateDeliveryStatus('123456789', ['101'], false, 'delivered'), null);
    assert.equal(store.updateDeliveryStatus('123456789', ['102'], false, 'seen'), null);
    store.put({ id: '101', cliMsgId: '201', threadId: '123456789', timestamp: 1,
      isSelf: true, deliveryStatus: 'sent', content: 'hello', senderName: 'Bạn (Tôi)' });
    assert.equal(store.getThread('123456789')[1].deliveryStatus, 'seen');
  } finally { store.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
