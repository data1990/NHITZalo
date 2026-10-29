const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function loadManager(dataDir) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dataDir } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    return require('../src/main/zaloManager');
  } finally {
    Module._load = originalLoad;
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-history-'));
}

test('legacy messages remain searchable after the recent-message cap and restart', () => {
  const dir = tempDir();
  const legacy = Array.from({ length: 5001 }, (_, i) => ({
    id: String(i + 1), threadId: 'friend-1', content: i === 0 ? 'needle from oldest message' : `message ${i}`,
    timestamp: i + 1, senderId: 'friend-1'
  }));
  fs.writeFileSync(path.join(dir, 'zalo_messages.json'), JSON.stringify(legacy));
  const ZaloManager = loadManager(dir);
  const first = new ZaloManager();
  first.addMessageToHistory({ id: 'new', threadId: 'friend-1', content: 'new', timestamp: 9999 }, true);
  const second = new ZaloManager();
  assert.equal(second.searchHistoryMessages('needle')[0].id, '1');
  assert.equal(fs.existsSync(path.join(dir, 'zalo_messages.json.bak')), true);
  assert.equal(second.getSyncStatus().totalMessages, 5002);
  assert.match(second.getSyncStatus().storageFilePath, /zalo_messages\.sqlite$/);
});

test('thread history is returned in pages ordered from newest to oldest', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  for (let i = 1; i <= 4; i++) manager.addMessageToHistory({ id: String(i), threadId: 'a', content: `a ${i}`, timestamp: i }, true);
  manager.addMessageToHistory({ id: 'other', threadId: 'b', content: 'b', timestamp: 5 }, true);
  assert.deepEqual(manager.getThreadHistory('a', 2, 0).map(m => m.id), ['4', '3']);
  assert.deepEqual(manager.getThreadHistory('a', 2, 2).map(m => m.id), ['2', '1']);
});

test('clearing history removes searchable and paged records', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.addMessageToHistory({ id: 'one', threadId: 'a', content: 'clear me', timestamp: 1 }, true);
  manager.clearHistoryMessages();
  assert.deepEqual(manager.searchHistoryMessages('clear me'), []);
  assert.deepEqual(manager.getThreadHistory('a'), []);
});

test('equal message IDs in different conversations are stored separately', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.addMessageToHistory({ id: '42', threadId: 'a', content: 'first', timestamp: 1 }, true);
  manager.addMessageToHistory({ id: '42', threadId: 'b', content: 'second', timestamp: 2 }, true);
  assert.equal(manager.getThreadHistory('a').length, 1);
  assert.equal(manager.getThreadHistory('b').length, 1);
});

test('a sent image placeholder becomes the actual image when Zalo echoes it', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager(null, null, null, null, null, null, dir);
  manager.addMessageToHistory({ id: 'image-1', threadId: '123456789', isSelf: true,
    isGroup: false, content: '[Hình ảnh đã gửi]', timestamp: 1, deliveryStatus: 'sent' }, true);
  manager.addMessageToHistory({ id: 'image-1', threadId: '123456789', isSelf: true,
    isGroup: false, isPhoto: true, photoUrl: 'https://example.com/photo.png',
    content: 'Ảnh thật', timestamp: 2 }, true);
  const message = manager.getThreadHistory('123456789')[0];
  assert.equal(message.isPhoto, true);
  assert.equal(message.photoUrl, 'https://example.com/photo.png');
  assert.equal(message.deliveryStatus, 'sent');
  assert.equal(manager.getThreadHistory('123456789').length, 1);
});

test('Zalo delivery and seen receipts update only the matching sent message across restart', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const updates = [];
  const manager = new ZaloManager(null, null, null, null, null, null, dir,
    status => updates.push(status));
  manager.addMessageToHistory({ id: '42', threadId: '123456789', isSelf: true,
    isGroup: false, deliveryStatus: 'sent', content: 'sent', timestamp: 1 }, true);
  manager.addMessageToHistory({ id: '42', threadId: '987654321', isSelf: true,
    isGroup: false, content: 'other chat', timestamp: 2 }, true);
  manager.addMessageToHistory({ id: '43', threadId: '123456789', isSelf: false,
    isGroup: false, content: 'received', timestamp: 3 }, true);
  manager.applyDeliveryReceipt({ type: 0, threadId: '123456789', data: {
    msgId: '42', realMsgId: '42', deliveredUids: ['123456789']
  } }, 'delivered');
  manager.applyDeliveryReceipt({ type: 0, threadId: '123456789', data: {
    msgId: '42', realMsgId: '42', idTo: '123456789'
  } }, 'seen');
  manager.applyDeliveryReceipt({ type: 0, threadId: '123456789', data: {
    msgId: '42', deliveredUids: ['123456789']
  } }, 'delivered');
  manager.saveMessagesHistory();
  assert.deepEqual(updates.map(update => update.deliveryStatus), ['delivered', 'seen']);
  const reopened = new ZaloManager(null, null, null, null, null, null, dir);
  assert.equal(reopened.getThreadHistory('123456789').find(message => message.id === '42').deliveryStatus, 'seen');
  assert.equal(reopened.getThreadHistory('987654321')[0].deliveryStatus, '');
});

test('history list includes old conversations outside the recent message window', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.messageStore.put({ id: 'old', threadId: 'old-friend', content: 'Tin cũ', timestamp: 1 });
  manager.messageStore.putMany(Array.from({ length: 5001 }, (_, i) => ({
    id: `new-${i}`, threadId: 'recent-friend', content: `Tin mới ${i}`, timestamp: i + 2
  })));
  manager.messagesHistory = manager.messageStore.getRecent(5000);
  const list = manager.getHistoryMessages();
  assert.equal(list.some(message => message.threadId === 'old-friend'), true);
  assert.equal(list.filter(message => message.threadId === 'old-friend').length, 1);
});

test('phone backup conversation IDs resolve to current Zalo IDs and names across restart', () => {
  const dir = tempDir();
  const MessageStore = require('../src/main/messageStore');
  const dbPath = path.join(dir, 'mapped.sqlite');
  const store = new MessageStore(dbPath);
  store.put({ id: 'old', threadId: '123456789', content: 'from phone', timestamp: 1,
    isGroup: false, isSelf: false, senderName: 'Bạn bè Zalo' });
  store.put({ id: 'live', threadId: '1234567890123456789', content: 'live', timestamp: 2,
    isGroup: false, isSelf: false });
  store.saveThreadIdentities([{ plainId: '123456789', noisedId: '1234567890123456789',
    isGroup: false, name: 'Tên đã khôi phục', avatar: 'avatar-url' }]);
  const reopened = new MessageStore(dbPath);
  const history = reopened.getThread('1234567890123456789');
  assert.deepEqual(history.map(m => m.id), ['live', 'old']);
  assert.equal(history[1].threadId, '1234567890123456789');
  assert.equal(history[1].threadName, 'Tên đã khôi phục');
  assert.equal(history[1].threadAvatar, 'avatar-url');
  assert.equal(reopened.getRecent()[1].threadName, 'Tên đã khôi phục');
  assert.equal(reopened.getLatestPerThread().every(m => m.threadId === '1234567890123456789'), true);
});

test('unresolved phone backup IDs retain their person or group type', () => {
  const dir = tempDir();
  const MessageStore = require('../src/main/messageStore');
  const store = new MessageStore(path.join(dir, 'identities.sqlite'));
  store.put({ id: 'person', threadId: '123456789', isGroup: false, content: 'hi', timestamp: 1 });
  store.put({ id: 'group', threadId: '987654321', isGroup: true, content: 'hi', timestamp: 2 });
  store.put({ id: 'known', threadId: '1234567890123456789', isGroup: false, content: 'hi', timestamp: 3 });
  assert.deepEqual(store.getUnresolvedBackupThreads().sort((a, b) => a.plainId.localeCompare(b.plainId)), [
    { plainId: '123456789', isGroup: false }, { plainId: '987654321', isGroup: true }
  ]);
});

test('phone backup outgoing messages regain their direction across restart', () => {
  const dir = tempDir();
  const MessageStore = require('../src/main/messageStore');
  const dbPath = path.join(dir, 'direction.sqlite');
  const store = new MessageStore(dbPath);
  store.put({ id: 'sent', threadId: '123456789', senderId: '555555555',
    senderName: 'Bạn bè Zalo', isGroup: false, isSelf: false, content: 'sent', timestamp: 1 });
  store.put({ id: 'received', threadId: '123456789', senderId: '123456789',
    senderName: 'Bạn bè Zalo', isGroup: false, isSelf: false, content: 'received', timestamp: 2 });
  store.setOwnPlainId('555555555');
  const reopened = new MessageStore(dbPath);
  const history = reopened.getThread('123456789');
  assert.equal(history[0].isSelf, false);
  assert.equal(history[1].isSelf, true);
  assert.equal(history[1].senderName, 'Bạn (Tôi)');
});

test('live Zalo voice message retains its playable m4a URL', () => {
  const ZaloManager = loadManager(tempDir());
  const manager = new ZaloManager();
  manager.currentUser = { userId: 'self-noised' };
  const message = manager.formatMessage({ type: 0, data: {
    msgId: 'voice-1', uidFrom: 'friend', idTo: 'self-noised', msgType: 'chat.voice', ts: 1000,
    content: { href: 'https://f1.voice.talk.zdn.vn/audio.amr',
      params: JSON.stringify({ m4a: 'https://f1.voice.talk.zdn.vn/audio.m4a' }) }
  } });
  assert.equal(message.voiceUrl, 'https://f1.voice.talk.zdn.vn/audio.amr');
  assert.equal(message.m4aUrl, 'https://f1.voice.talk.zdn.vn/audio.m4a');
  assert.equal(message.isSelf, false);
});

test('live group mention retains the tagged user ID and position', () => {
  const ZaloManager = loadManager(tempDir());
  const manager = new ZaloManager();
  const message = manager.formatMessage({ type: 1, data: {
    msgId: 'mention-1', grid: '1234567890123456789', uidFrom: '5555555550123456789',
    msgType: 'webchat', ts: 1000, content: 'Chào @Lan',
    mentions: [{ pos: 5, len: 4, uid: '9876543210123456789' }]
  } });
  assert.deepEqual(message.mentions, [{ pos: 5, len: 4, uid: '9876543210123456789' }]);
});

test('existing phone backup messages acquire real names without resynchronizing the phone', async () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const phases = [];
  const manager = new ZaloManager(null, null, status => phases.push(status.phase));
  manager.messageStore.put({ id: 'old', threadId: '123456789', isGroup: false,
    content: 'saved', timestamp: 1, senderName: 'Bạn bè Zalo' });
  manager.api = {
    getContext: () => ({ secretKey: 'test', cookie: { setCookie: async () => {} } }),
    getUserInfo: async () => ({ changed_profiles: {
      '1234567890123456789': { userId: '1234567890123456789', displayName: 'Tên đúng' }
    } })
  };
  manager.loadSession = () => ({ cookie: [{ key: 'zpw_sek', value: 'test' }] });
  manager.identityUtils = {
    encodeAES: (_key, value) => value, decodeAES: (_key, value) => value,
    makeURL: (_ctx, url) => url,
    request: async () => ({ ok: true, status: 200, json: async () => ({ error_code: 0,
      data: JSON.stringify({ error_code: 0, data: { fids: ['1234567890123456789'], gids: [] } }) }) })
  };
  await manager.resolveBackupThreadIdentities();
  assert.equal(manager.getHistoryMessages()[0].threadName, 'Tên đúng');
  assert.equal(manager.getHistoryMessages()[0].threadId, '1234567890123456789');
  assert.equal(phases.includes('identities_updated'), true);
});

test('history feed keeps newly received messages before the disk debounce flush', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.addMessageToHistory({ id: 'pending', threadId: 'current', content: 'new', timestamp: 1 });
  assert.equal(manager.getHistoryMessages().some(message => message.id === 'pending'), true);
});

test('conversation heads load one message per thread and include pending messages', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.messageStore.putMany(Array.from({ length: 120 }, (_, index) => ({
    id: `old-${index}`, threadId: 'friend', content: 'old', timestamp: index
  })));
  manager.messageStore.put({ id: 'group', threadId: 'group', isGroup: true, content: 'group', timestamp: 1 });
  manager.messagesHistory = manager.messageStore.getRecent(5000);
  manager.addMessageToHistory({ id: 'pending', threadId: 'friend', content: 'new', timestamp: 1000 });
  const heads = manager.getConversationHeads();
  assert.equal(heads.length, 2);
  assert.equal(heads.find(message => message.threadId === 'friend').id, 'pending');
});

test('bubble startup loads a bounded recent window', () => {
  const dir = tempDir();
  const ZaloManager = loadManager(dir);
  const manager = new ZaloManager();
  manager.messageStore.putMany(Array.from({ length: 500 }, (_, index) => ({
    id: `message-${index}`, threadId: 'friend', content: 'text', timestamp: index
  })));
  const startup = manager.getBubbleStartupMessages();
  assert.equal(startup.length, 250);
  assert.equal(startup[0].id, 'message-499');
});
