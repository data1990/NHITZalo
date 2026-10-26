const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

function createManager() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-sync-'));
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
  const statuses = [];
  const manager = new ZaloManager(null, null, status => statuses.push(status));
  manager.api = { listener: { ws: { readyState: 1 }, requestOldMessages() {} } };
  manager.listener = manager.api.listener;
  return { manager, statuses };
}

test('quick sync persists actual messages without requesting a phone backup', async () => {
  const { manager, statuses } = createManager();
  manager.preloadContacts = async () => {};
  manager.requestSyncFromMobile = async () => { throw new Error('phone backup must not be requested'); };
  manager.scanOldMessages = async () => {
    manager.addMessageToHistory({ id: 'm-1', threadId: 't-1', timestamp: 100, content: 'hello' });
    return 1;
  };
  const result = await manager.quickSyncMessages();
  assert.equal(result.success, true);
  assert.equal(result.added, 1);
  assert.equal(manager.messageStore.getStats().totalMessages, 1);
  assert.equal(statuses.at(-1).phase, 'completed');
  assert.equal(manager.isSyncing, false);
});

test('offline quick sync fails without reporting completion and can be retried', async () => {
  const { manager, statuses } = createManager();
  manager.listener.ws.readyState = 3;
  manager.preloadContacts = async () => {};
  const result = await manager.quickSyncMessages();
  assert.equal(result.success, false);
  assert.notEqual(statuses.at(-1)?.phase, 'completed');
  assert.equal(manager.isSyncing, false);
});

test('quick sync resets busy state after a scan error', async () => {
  const { manager, statuses } = createManager();
  manager.preloadContacts = async () => {};
  manager.scanOldMessages = async () => { throw new Error('socket failed'); };
  const result = await manager.quickSyncMessages();
  assert.equal(result.success, false);
  assert.match(result.error, /socket failed/);
  assert.equal(statuses.at(-1).phase, 'failed');
  assert.equal(manager.isSyncing, false);
});

test('old message pagination advances by the last returned action ID', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  const calls = [];
  listener.requestOldMessages = (type, lastId) => {
    calls.push([type, lastId]);
    queueMicrotask(() => listener.emit('old_messages', type === 0 && !lastId
      ? [{ data: { actionId: '10', msgId: 'm-1' } }] : [], type));
  };
  manager.listener = listener;
  const received = await manager.scanOldMessages(3);
  assert.equal(received, 1);
  assert.deepEqual(calls, [[0, null], [0, '10'], [1, null]]);
});

test('full available-history scan continues beyond the old eight-page limit and stores every page', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.start = () => {};
  const calls = [];
  listener.requestOldMessages = (type, lastId) => {
    calls.push([type, lastId]);
    const page = type === 0 && (lastId === null || Number(lastId) < 10)
      ? Number(lastId || 0) + 1 : null;
    queueMicrotask(() => listener.emit('old_messages', page
      ? [{ type, threadId: 'friend', data: { actionId: String(page), msgId: String(page), uidFrom: 'friend', content: `message ${page}`, ts: page } }]
      : [], type));
  };
  manager.api.listener = listener;
  manager.initListener();
  manager.scanDelayMs = 0;

  const received = await manager.scanAllAvailableMessages();
  assert.equal(received, 10);
  assert.equal(manager.messageStore.getStats().totalMessages, 10);
  assert.deepEqual(calls.at(-1), [1, null]);
  assert.deepEqual(calls[10], [0, '10']);
});

test('full history scan rejects a page whose cursor does not advance', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.requestOldMessages = (type) => queueMicrotask(() => listener.emit('old_messages',
    type === 0 ? [{ data: { actionId: 'same', msgId: 'same' } }] : [], type));
  manager.listener = listener;
  manager.scanDelayMs = 0;
  await assert.rejects(() => manager.scanOldMessages(), /cursor|trang lịch sử|lặp/i);
});

test('socket disconnect during a history request is reported as a failure', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.requestOldMessages = () => queueMicrotask(() => listener.emit('disconnected', 'network'));
  manager.listener = listener;
  await assert.rejects(() => manager.scanOldMessages(1), /ngắt kết nối|disconnected/i);
});

test('automatic recent catch-up saves only missing messages and does not replay duplicates', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.cipherKey = 'ready';
  listener.start = () => {};
  const requests = [];
  listener.requestOldMessages = (type, cursor) => {
    requests.push([type, cursor]);
    const page = type === 0 && cursor == null ? [
      { type: 0, threadId: 'friend', data: { actionId: '22', msgId: 'new', uidFrom: 'friend', content: 'new', ts: 200 } },
      { type: 0, threadId: 'friend', data: { actionId: '21', msgId: 'known', uidFrom: 'friend', content: 'known', ts: 100 } }
    ] : [];
    queueMicrotask(() => listener.emit('old_messages', page, type));
  };
  manager.api.listener = listener;
  manager.initListener();
  manager.messageStore.put({ id: 'known', threadId: 'friend', content: 'known', timestamp: 100 });
  const events = [];
  manager.onNewMessage = (message, isOld) => events.push([message.id, isOld]);
  const first = await manager.catchUpRecentMessages();
  const second = await manager.catchUpRecentMessages();
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.ok(manager.getSyncStatus().lastRecentCheckTime);
  assert.equal(manager.getSyncStatus().lastRecentAdded, 0);
  assert.equal(manager.messageStore.getStats().totalMessages, 2);
  assert.deepEqual(events, [['new', true]]);
  assert.deepEqual(requests, [[0, null], [1, null], [0, null], [1, null]]);
  clearInterval(manager.recentCatchupTimer);
});

test('automatic catch-up continues to an older page until stored history is reached', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  const calls = [];
  listener.requestOldMessages = (type, cursor) => {
    calls.push([type, cursor]);
    const page = type === 0 && cursor == null
      ? Array.from({ length: 50 }, (_, index) => ({ type: 0, threadId: 'friend',
        data: { actionId: String(100 - index), msgId: `new-${index}`, uidFrom: 'friend', content: 'new', ts: 200 - index } }))
      : type === 0 ? [{ type: 0, threadId: 'friend',
        data: { actionId: 'old', msgId: 'known', uidFrom: 'friend', content: 'known', ts: 100 } }] : [];
    queueMicrotask(() => listener.emit('old_messages', page, type));
  };
  manager.listener = listener;
  manager.scanDelayMs = 0;
  manager.messageStore.put({ id: 'known', threadId: 'friend', content: 'known', timestamp: 100 });
  const result = await manager.catchUpRecentMessages();
  assert.equal(result.added, 50);
  assert.equal(manager.messageStore.getStats().totalMessages, 51);
  assert.deepEqual(calls, [[0, null], [0, '51'], [1, null]]);
});

test('automatic catch-up resumes beyond its page limit on the next check', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  manager.listener = listener;
  manager.recentCatchupPageLimit = 1;
  const calls = [];
  listener.requestOldMessages = (type, cursor) => {
    calls.push([type, cursor]);
    const page = type === 0 && cursor == null
      ? Array.from({ length: 50 }, (_, index) => ({ type: 0, threadId: 'friend',
        data: { actionId: String(100 - index), msgId: `new-${index}`, uidFrom: 'friend', content: 'new', ts: 200 - index } }))
      : type === 0 ? [{ type: 0, threadId: 'friend',
        data: { actionId: 'old', msgId: 'known', uidFrom: 'friend', content: 'known', ts: 100 } }] : [];
    queueMicrotask(() => listener.emit('old_messages', page, type));
  };
  manager.messageStore.put({ id: 'known', threadId: 'friend', content: 'known', timestamp: 100 });
  await manager.catchUpRecentMessages();
  await manager.catchUpRecentMessages();
  assert.deepEqual(calls.filter(([type]) => type === 0), [[0, null], [0, '51']]);
  assert.equal(manager.messageStore.getStats().totalMessages, 51);
});

test('manual history sync waits for automatic catch-up to release the socket', async () => {
  const { manager } = createManager();
  let releaseCatchup;
  manager.recentCatchupPromise = new Promise(resolve => { releaseCatchup = resolve; });
  let scanStarted = false;
  manager.scanOldMessages = async () => { scanStarted = true; return 0; };
  const sync = manager.quickSyncMessages();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scanStarted, false);
  releaseCatchup();
  const result = await sync;
  assert.equal(result.success, true);
  assert.equal(scanStarted, true);
});

test('socket cipher key schedules automatic catch-up after connection', async () => {
  const { manager } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.start = () => {};
  manager.api.listener = listener;
  manager.recentCatchupDelayMs = 0;
  const connectionStatuses = [];
  manager.onStatusChange = status => connectionStatuses.push(status.status);
  let calls = 0;
  manager.catchUpRecentMessages = async () => { calls++; return { added: 0 }; };
  manager.initListener();
  listener.emit('connected');
  assert.equal(connectionStatuses.at(-1), 'connecting');
  listener.emit('cipher_key', 'key');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 1);
  assert.equal(connectionStatuses.at(-1), 'connected');
  clearInterval(manager.recentCatchupTimer);
});

test('startup quick sync waits for the cipher key and runs once per app launch', async () => {
  const { manager, statuses } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.start = () => {};
  manager.api.listener = listener;
  manager.recentCatchupDelayMs = 0;
  let calls = 0;
  manager.catchUpRecentMessages = async () => { calls++; return { added: 3 }; };
  manager.requestStartupQuickSync();
  manager.initListener();
  listener.emit('connected');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 0);
  listener.emit('cipher_key', 'key');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.deepEqual(statuses.filter(item => item.phase?.startsWith('startup_'))
    .map(item => item.phase), ['startup_scanning', 'startup_completed']);
  listener.emit('cipher_key', 'key');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2, 'regular catch-up continues after the single startup run');
  clearInterval(manager.recentCatchupTimer);
});

test('startup quick sync does not report completion while the socket scan is deferred', async () => {
  const { manager, statuses } = createManager();
  manager.requestStartupQuickSync();
  manager.catchUpRecentMessages = async () => ({ added: 0, skipped: true });
  const result = await manager.runStartupQuickSync();
  assert.equal(result.skipped, true);
  assert.equal(manager.startupQuickSyncPending, true);
  assert.ok(!statuses.some(item => item.phase === 'startup_completed'));
});

test('quick sync does not report success while the socket is unavailable', async () => {
  const { manager } = createManager();
  manager.listener.ws.readyState = 3;
  manager.listener.start = () => {};
  const result = await manager.quickSyncMessages();
  assert.equal(result.success, false);
});

test('large sync keeps every newly received message in SQLite beyond the memory cap', async () => {
  const { manager } = createManager();
  manager.scanOldMessages = async () => {
    for (let i = 1; i <= 5001; i++) {
      manager.addMessageToHistory({ id: `m-${i}`, threadId: 'large', timestamp: i, content: `message ${i}` });
    }
    return 5001;
  };
  const result = await manager.quickSyncMessages();
  assert.equal(result.success, true);
  assert.equal(result.added, 5001);
  assert.equal(manager.messageStore.getStats().totalMessages, 5001);
});

test('phone sync sends a request and remains pending until a phone response', async () => {
  const { manager, statuses } = createManager();
  let requests = 0;
  manager.requestSyncFromMobile = async () => { requests++; return { success: true }; };
  manager.scanOldMessages = async () => { throw new Error('must not scan before confirmation'); };
  const result = await manager.syncOldMessages();
  assert.equal(requests, 1);
  assert.equal(result.success, false);
  assert.equal(result.requestAccepted, true);
  assert.equal(result.waitingPhone, true);
  assert.equal(result.completed, false);
  assert.equal(statuses.at(-1).phase, 'waiting_phone');
  assert.equal(manager.isSyncing, true);
});

test('failed phone request is reported as failure and unlocks another attempt', async () => {
  const { manager, statuses } = createManager();
  manager.requestSyncFromMobile = async () => ({ success: false, error: 'server rejected' });
  const result = await manager.syncOldMessages();
  assert.equal(result.success, false);
  assert.match(result.error, /server rejected/);
  assert.equal(statuses.at(-1).phase, 'failed');
  assert.equal(manager.isSyncing, false);
});

test('phone request sends encrypted parameters before waking the phone', async () => {
  const { manager } = createManager();
  const calls = [];
  let parameters;
  manager.api.getContext = () => ({ imei: 'device', secretKey: 'secret' });
  manager.api.zpwServiceMap = { file: ['https://file.example'] };
  manager.listener.start = () => {};
  manager.listener.requestMobileWakeUp = () => calls.push('wake');
  manager.syncRequestUtils = {
    encodeAES: (_key, value) => { parameters = JSON.parse(value); return 'encrypted'; },
    makeURL: (_ctx, url) => url,
    request: async () => { calls.push('request'); return { json: async () => ({ error_code: 0 }) }; }
  };
  const result = await manager.requestSyncFromMobile();
  assert.equal(result.success, true);
  assert.equal(parameters.pc_name.length > 0, true);
  assert.equal(parameters.from_seq_id, 0);
  assert.equal(parameters.public_key.length > 100, true);
  assert.deepEqual(calls, ['request', 'wake']);
});

test('phone transfer reports only actual stored messages and never claims full backup import', async () => {
  const { manager, statuses } = createManager();
  manager.isSyncing = true;
  manager.phoneSyncState = { active: true, isPreparing: true, isFinished: false, beforeCount: 0 };
  manager.scanOldMessages = async () => {
    manager.addMessageToHistory({ id: 'from-socket', threadId: 'contact', timestamp: 1, content: 'hello' });
    return 1;
  };
  await manager.finishPhoneSync();
  assert.equal(manager.messageStore.getStats().totalMessages, 1);
  assert.equal(statuses.at(-1).phase, 'partial');
  assert.equal(statuses.at(-1).added, 1);
  assert.equal(manager.isSyncing, false);
  assert.equal(statuses.some(status => status.phase === 'completed'), false);
});

test('failed phone archive stays visibly incomplete even when recent messages were saved', async () => {
  const { manager, statuses } = createManager();
  manager.isSyncing = true;
  manager.phoneSyncState = { active: true, isPreparing: true, isFinished: false, beforeCount: 0 };
  manager.phoneSyncBackupInfo = { deviceName: 'iPhone', url: 'https://trans-bin.zaloapp.com/download/example',
    encryptedKey: 'encrypted', format: 1 };
  manager.importPhoneBackup = async () => { throw new Error('HTTP 400'); };
  manager.scanAllAvailableMessages = async () => {
    manager.addMessageToHistory({ id: 'recent-1', threadId: 'contact', timestamp: 1, content: 'recent' });
  };
  manager.syncRecentGroupsHistory = async () => 0;
  await manager.finishPhoneSync();
  assert.equal(statuses.at(-1).phase, 'partial');
  assert.match(statuses.at(-1).title, /chưa hoàn tất/i);
  assert.match(statuses.at(-1).message, /HTTP 400/);
  assert.equal(statuses.at(-1).progress, 0);
});

test('phone transfer reports archive completion only after decrypted conversations are stored', async () => {
  const { manager, statuses } = createManager();
  manager.isSyncing = true;
  manager.phoneSyncState = { active: true, isPreparing: true, isFinished: false, beforeCount: 0 };
  manager.phoneSyncBackupInfo = { url: 'https://trans-bin.zaloapp.com/download/example',
    encryptedKey: 'encrypted', format: 1, totalMsgs: 3, totalThreads: 1 };
  manager.importPhoneBackup = async () => {
    manager.addMessageToHistory({ id: 'archive-1', threadId: 'contact', timestamp: 1, content: 'full text' });
    manager.flushMessagesHistory();
    return { imported: 1, added: 1, conversations: 1 };
  };
  manager.scanOldMessages = async () => 0;

  await manager.finishPhoneSync();
  assert.equal(statuses.at(-1).phase, 'completed');
  assert.equal(statuses.at(-1).imported, 1);
  assert.equal(manager.messageStore.getStats().totalMessages, 1);
  assert.equal(manager.isSyncing, false);
});

test('transfer completion without phone confirmation cannot be reported as success', async () => {
  const { manager, statuses } = createManager();
  manager.isSyncing = true;
  manager.phoneSyncState = { active: true, isPreparing: false, isFinished: false };
  manager.scanOldMessages = async () => { throw new Error('scan must not run'); };
  await manager.finishPhoneSync();
  assert.equal(statuses.at(-1).phase, 'failed');
  assert.equal(manager.isSyncing, false);
});

test('backup metadata and transfer_error code zero never claim messages were imported', async () => {
  const { manager, statuses } = createManager();
  const listener = new EventEmitter();
  listener.ws = { readyState: 1 };
  listener.start = () => {};
  manager.api.listener = listener;
  manager.initListener();
  manager.syncPublicKey = 'request-key';
  manager.isSyncing = true;
  manager.phoneSyncState = { active: true, isWaiting: false, isPreparing: true,
    isFinished: false, packetsReceived: 0, beforeCount: 0, startTime: Date.now() };
  manager.scanOldMessages = async () => 0;
  manager.syncRecentGroupsHistory = async () => 0;

  listener.emit('sync_event', { act: 'syncmsg_info', data: {
    public_key: 'request-key', file_name: 'ZaloDB_2', file_size: 100,
    db_info: JSON.stringify({ backup_db: { msg_total: 600, msg_thread: 10 } }),
    url: 'https://trans-bin.zaloapp.com/download/example', encrypted_key: 'secret'
  } });
  listener.emit('sync_event', { act: 'transfer_error', data: {
    public_key: 'request-key', error_code: 0
  } });

  assert.equal(manager.phoneSyncState.sawLastPacket, true);
  assert.equal(statuses.at(-1).phase, 'phone_transferring');
  assert.equal(statuses.at(-1).progress, 75);
  await manager.finishPhoneSync();
  assert.equal(statuses.at(-1).phase, 'failed');
  assert.equal(statuses.some(status => status.phase === 'completed'), false);
  assert.equal(manager.isSyncing, false);
});
