const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function createManager() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-send-'));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dataDir } };
    return originalLoad.call(this, request, parent, isMain);
  };
  let ZaloManager;
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    ZaloManager = require('../src/main/zaloManager');
  } finally {
    Module._load = originalLoad;
  }
  const sent = [];
  const received = [];
  const manager = new ZaloManager(null, message => received.push(message));
  manager.currentUser = { userId: '999', name: 'Me' };
  manager.api = {
    getContext: () => ({ uid: '999' }),
    sendMessage: async (payload, threadId, type) => {
      sent.push({ payload, threadId, type });
      return { data: { msgId: 'm-1' } };
    },
    sendSticker: async (sticker, threadId, type) => {
      sent.push({ sticker, threadId, type });
      return { data: { msgId: 's-1' } };
    },
    forwardMessage: async (payload, type) => {
      sent.push({ payload, type });
      return { success: [{ clientId: 'c-1', msgId: 'f-1' }], failed: [] };
    }
  };
  return { manager, sent, received, dataDir };
}

test('file attachment goes to the selected personal conversation', async () => {
  const { manager, sent, received } = createManager();
  const result = await manager.sendReply('12345', 'file', false, null, ['C:/tmp/example.pdf']);
  assert.equal(sent[0].threadId, '12345');
  assert.equal(sent[0].type, 0);
  assert.deepEqual(sent[0].payload.attachments, ['C:/tmp/example.pdf']);
  assert.equal(result.message.threadId, '12345');
  assert.equal(received[0].threadId, '12345');
});

test('pasted image uses the attachment receipt and appears as an image message placeholder', async () => {
  const { manager, sent } = createManager();
  manager.api.sendMessage = async (payload, threadId, type) => {
    sent.push({ payload, threadId, type });
    return { message: null, attachment: [{ msgId: 'image-42' }] };
  };
  const result = await manager.sendReply('12345', '', false, null, ['C:/tmp/clipboard_img.png']);
  assert.deepEqual(sent[0].payload.attachments, ['C:/tmp/clipboard_img.png']);
  assert.equal(result.message.id, 'image-42');
  assert.equal(result.message.content, '[Hình ảnh đã gửi]');
});

test('sticker goes to the selected group conversation', async () => {
  const { manager, sent, received } = createManager();
  await manager.sendSticker('67890', { id: 111, cateId: 222 }, true);
  assert.equal(sent[0].threadId, '67890');
  assert.equal(sent[0].type, 1);
  assert.equal(received[0].threadId, '67890');
  assert.equal(received[0].isGroup, true);
});

test('text forwarding uses the selected destination', async () => {
  const { manager, sent } = createManager();
  const result = await manager.forwardTextMessage({ id: 'm-1', content: 'hello' }, '555', true);
  assert.equal(result.success, true);
  assert.deepEqual(sent[0], { payload: { message: 'hello', threadIds: ['555'] }, type: 1 });
});

test('media forwarding fails clearly before making a network request', async () => {
  const { manager, sent } = createManager();
  await assert.rejects(
    () => manager.forwardTextMessage({ id: 'photo-1', content: 'photo', isPhoto: true }, '555', false),
    /chưa hỗ trợ chuyển tiếp ảnh|chưa hỗ trợ chuyển tiếp media/i
  );
  assert.equal(sent.length, 0);
});

test('muting a group uses the API group type and saves only after success', async () => {
  const { manager } = createManager();
  let receivedType = null;
  manager.api.setMute = async (_params, _id, type) => { receivedType = type; };
  const result = await manager.setThreadMute('g-1', true, true);
  assert.equal(result.success, true);
  assert.equal(receivedType, 1);
  assert.equal(manager.isThreadMuted('g-1'), true);
});

test('failed server mute does not persist a false local state', async () => {
  const { manager } = createManager();
  manager.api.setMute = async () => { throw new Error('server rejected'); };
  const result = await manager.setThreadMute('g-1', true, true);
  assert.equal(result.success, false);
  assert.equal(manager.isThreadMuted('g-1'), false);
});

test('failed server pin does not persist a false local state', async () => {
  const { manager } = createManager();
  manager.api.setPinnedConversations = async () => { throw new Error('server rejected'); };
  const result = await manager.setPinnedConversation('g-1', true, true);
  assert.equal(result.success, false);
  assert.deepEqual(manager.getPinnedThreads(), []);
});

test('server pinned people and groups load into the conversation list', async () => {
  const { manager } = createManager();
  manager.api.getPinConversations = async () => ({ conversations: ['u123456789', 'g987654321', 'm1'] });
  assert.deepEqual(await manager.fetchPinnedThreads(), ['123456789', '987654321']);
  assert.deepEqual(manager.getPinnedThreads(), ['123456789', '987654321']);
});

test('failed pinned conversation refresh keeps locally saved pins', async () => {
  const { manager } = createManager();
  manager.pinnedThreads.add('123456789');
  manager.api.getPinConversations = async () => { throw new Error('temporary server error'); };
  assert.deepEqual(await manager.fetchPinnedThreads(), ['123456789']);
});

test('group tools return server board and reminder lists', async () => {
  const { manager } = createManager();
  manager.api.getListBoard = async (_options, groupId) => ({ items: [{ boardType: 3, data: { question: 'Ăn gì?' } }], count: 1 });
  manager.api.getListReminder = async (_options, threadId, type) => {
    assert.equal(threadId, 'group-1');
    assert.equal(type, 1);
    return [{ id: 'r1', params: { title: 'Họp' } }];
  };
  const result = await manager.getConversationTools('group-1', true);
  assert.equal(result.boards[0].data.question, 'Ăn gì?');
  assert.equal(result.reminders[0].params.title, 'Họp');
});

test('pinned boards remain available when reminders cannot be loaded', async () => {
  const { manager } = createManager();
  manager.api.getListBoard = async () => ({ items: [{ boardType: 2, data: { id: 'pin-1' } }] });
  manager.api.getListReminder = async () => { throw new Error('reminders unavailable'); };
  const result = await manager.getConversationTools('group-1', true);
  assert.equal(result.boards[0].data.id, 'pin-1');
  assert.deepEqual(result.reminders, []);
});

test('reaction updates only the message in the selected conversation', async () => {
  const { manager } = createManager();
  const first = { id: '123', cliMsgId: '456', threadId: 'first', timestamp: 1, content: 'first' };
  const second = { id: '123', cliMsgId: '789', threadId: 'second', timestamp: 2, content: 'second' };
  manager.messagesHistory = [first, second];
  let destination;
  manager.api.addReaction = async (_icon, target) => { destination = target; return {}; };
  await manager.sendReaction('second', '123', '789', '👍', false);
  assert.equal(destination.threadId, 'second');
  assert.equal(destination.data.cliMsgId, 789);
  assert.equal(first.reactions, undefined);
  assert.equal(second.reactions?.[0]?.icon, '👍');
});

test('recall updates only the message in the selected conversation', async () => {
  const { manager } = createManager();
  const first = { id: '123', threadId: 'first', timestamp: 1, content: 'first' };
  const second = { id: '123', threadId: 'second', timestamp: 2, content: 'second' };
  manager.messagesHistory = [first, second];
  manager.api.undo = async () => ({});
  await manager.undoMessage('second', '123', '789', false);
  assert.equal(first.isRevoked, undefined);
  assert.equal(second.isRevoked, true);
});
