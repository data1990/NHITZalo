const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('personal conversation tools read friend boards alongside existing pinned topics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-personal-pins-'));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dir } };
    return originalLoad.call(this, request, parent, isMain);
  };
  let ZaloManager;
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    ZaloManager = require('../src/main/zaloManager');
  } finally {
    Module._load = originalLoad;
  }
  const manager = new ZaloManager();
  const calls = [];
  manager.api = { getFriendBoardList: async id => {
    calls.push(id);
    return { data: ['pin'] };
  } };
  manager.getServerPinnedTopics = async () => [{ id: 'existing-pin' }];
  const result = await manager.getConversationTools('friend-42', false);
  assert.deepEqual(calls, ['friend-42']);
  assert.deepEqual(result.friendBoards, { data: ['pin'] });
  assert.deepEqual(result.pinTopics, [{ id: 'existing-pin' }]);
  manager.messageStore.close?.();
});
