const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function createManager() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-group-senders-'));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dataDir } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    const ZaloManager = require('../src/main/zaloManager');
    return new ZaloManager();
  } finally {
    Module._load = originalLoad;
  }
}

test('a group sender uses a restored member name after reloading stored history', () => {
  const manager = createManager();
  manager.messageStore.put({ id: 'msg-1', threadId: 'group-1', isGroup: true,
    senderId: '123456789', senderName: '', content: 'hello', timestamp: 1 });
  manager.messageStore.saveThreadIdentities([{ plainId: '123456789', noisedId: '1234567890123456789',
    isGroup: false, name: 'Người gửi nhóm', avatar: 'https://example.test/avatar.jpg' }]);
  const message = manager.messageStore.getThread('group-1')[0];
  assert.equal(message.senderName, 'Người gửi nhóm');
  assert.equal(message.avatar, 'https://example.test/avatar.jpg');
});

test('opening a group resolves legacy sender IDs and saves member names', async () => {
  const manager = createManager();
  manager.api = { getContext: () => ({ secretKey: 'test', cookie: { setCookie: async () => {} } }),
    getUserInfo: async ids => ({ changed_profiles: {
      [ids[0]]: { userId: ids[0], displayName: 'Thành viên có tên', avatar: 'avatar-url' }
    } }) };
  manager.loadSession = () => ({ cookie: [{ key: 'zpw_sek', value: 'test-cookie' }] });
  let mapped = 0;
  manager.identityUtils = { encodeAES: (_key, value) => value, decodeAES: (_key, value) => value,
    makeURL: (_ctx, url) => url,
    request: async () => { mapped++; return { ok: true, json: async () => ({ error_code: 0,
      data: JSON.stringify({ error_code: 0, data: { fids: ['1234567890123456789'], gids: [] } }) }) }; } };
  const first = await manager.resolveGroupSenderNames('group-1', ['123456789']);
  const second = await manager.resolveGroupSenderNames('group-1', ['123456789']);
  assert.equal(first[0].name, 'Thành viên có tên');
  assert.equal(second[0].name, 'Thành viên có tên');
  assert.equal(mapped, 1);
});
