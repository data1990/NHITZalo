const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function createManager() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-cloud-'));
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
  return new ZaloManager();
}

test('my Cloud uses the send2me ID returned by Zalo login', () => {
  const manager = createManager();
  manager.api = { getContext: () => ({ uid: 'account-id', loginInfo: { send2me_id: '9876543210123456789' } }) };
  assert.equal(manager.getMyCloudId(), '9876543210123456789');
  assert.equal(manager.getSyncStatus().myCloudId, '9876543210123456789');
});

test('my Cloud loads and stores its recent page with the isOA flag', async () => {
  const manager = createManager();
  manager.api = { getContext: () => ({ uid: 'account-id', imei: 'test-imei',
    loginInfo: { send2me_id: '9876543210123456789' } }) };
  let request;
  manager.requestCloudPage = async (endpoint, params) => {
    request = { endpoint, params };
    return { groupMsgs: [{ msgType: 'webchat', msgId: 'cloud-1', cliMsgId: 'cli-1',
      uidFrom: '0', content: 'Cloud note', ts: 1000 }], hasMore: true, lastMsgId: 'cloud-1' };
  };
  const result = await manager.fetchCloudMessages();
  assert.equal(request.endpoint, '/api/cm/getrecentv2');
  assert.equal(request.params.groupId, '9876543210123456789');
  assert.equal(request.params.isOA, 1);
  assert.equal(request.params.imei, 'test-imei');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].threadId, '9876543210123456789');
  assert.equal(result.messages[0].threadName, 'Cloud của tôi');
  assert.equal(manager.messageStore.getThread('9876543210123456789')[0].content, 'Cloud note');
});

test('my Cloud requests older pages without repeating an existing message', async () => {
  const manager = createManager();
  manager.api = { getContext: () => ({ uid: 'account-id', imei: 'test-imei',
    loginInfo: { send2me_id: '9876543210123456789' } }) };
  manager.messageStore.put({ id: 'known', threadId: '9876543210123456789', content: 'known', timestamp: 100 });
  let request;
  manager.requestCloudPage = async (endpoint, params) => {
    request = { endpoint, params };
    return { groupMsgs: [{ msgType: 'webchat', msgId: 'known', cliMsgId: 'known-cli',
      uidFrom: '0', content: 'known', ts: 100 }], hasMore: false, lastMsgId: 'known' };
  };
  const result = await manager.fetchCloudMessages('cursor-1', true);
  assert.equal(request.endpoint, '/api/cm/getoldv2');
  assert.equal(request.params.globalMsgId, 'cursor-1');
  assert.equal(result.messages.length, 0);
  assert.equal(result.hasMore, false);
});

test('Cloud rate limit pauses further requests instead of retrying on every render', async () => {
  const manager = createManager();
  manager.api = { getContext: () => ({ uid: 'account-id', imei: 'test-imei',
    loginInfo: { send2me_id: '9876543210123456789' } }) };
  let calls = 0;
  manager.requestCloudPage = async () => { calls++; const error = new Error('Stop retry'); error.code = -69; throw error; };
  await assert.rejects(manager.fetchCloudMessages(), /giới hạn yêu cầu/);
  await assert.rejects(manager.fetchCloudMessages(), /giới hạn yêu cầu/);
  assert.equal(calls, 1);
});

test('group conversation tools include Zalo pin/list topics', async () => {
  const manager = createManager();
  manager.api = { getListBoard: async () => ({ items: [] }), getListReminder: async () => [] };
  manager.getServerPinnedTopics = async threadId => {
    assert.equal(threadId, 'group-1');
    return [{ id: 'board-1', params: '{"msg_id":"message-1"}' }];
  };
  const tools = await manager.getConversationTools('group-1', true);
  assert.equal(tools.pinTopics.length, 1);
  assert.equal(tools.pinTopics[0].id, 'board-1');
});

test('personal conversation tools also request pinned topics', async () => {
  const manager = createManager();
  manager.api = { getListReminder: async () => [] };
  manager.getServerPinnedTopics = async threadId => [{ id: `pin-${threadId}` }];
  const tools = await manager.getConversationTools('friend-1', false);
  assert.deepEqual(tools.pinTopics, [{ id: 'pin-friend-1' }]);
});

test('pin/list request follows the Zalo PC group-board protocol', async () => {
  const manager = createManager();
  const utils = require(path.join(__dirname, '..', 'node_modules', 'zalo-api-final', 'dist', 'cjs', 'utils.cjs'));
  const secretKey = Buffer.alloc(32, 7).toString('base64');
  let requestUrl;
  const ctx = { imei: 'test-imei', secretKey, API_VERSION: 647, API_TYPE: 30,
    cookie: { getCookieString: async () => 'session=test' }, userAgent: 'test',
    options: { polyfill: async url => {
      requestUrl = new URL(url);
      return { ok: true, headers: { get: () => null, getSetCookie: () => [] },
        json: async () => ({ error_code: 0,
          data: utils.encodeAES(secretKey, JSON.stringify({ data: { items: [{ id: 'pin-1' }] } })) }) };
    } } };
  manager.api = { getContext: () => ctx, zpwServiceMap: { group_board: ['https://board.example'] } };
  const topics = await manager.getServerPinnedTopics('g_123');
  assert.equal(requestUrl.pathname, '/api/board/pin/list');
  const params = JSON.parse(utils.decodeAES(secretKey, requestUrl.searchParams.get('params')));
  assert.deepEqual(params, { groupId: '123', boardVersion: 0, imei: 'test-imei' });
  assert.deepEqual(topics, [{ id: 'pin-1' }]);
});
