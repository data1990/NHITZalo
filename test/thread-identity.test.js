const test = require('node:test');
const assert = require('node:assert/strict');
const { requestNoisedIds, fetchThreadProfiles } = require('../src/main/threadIdentity');

test('Zalo backup plain IDs map by position to current person and group IDs', async () => {
  let cookie = '';
  const ctx = { secretKey: 'test', cookie: { setCookie: async value => { cookie = value; } } };
  const utils = {
    encodeAES: (_key, value) => value,
    decodeAES: (_key, value) => value,
    makeURL: (_ctx, url) => url,
    request: async (_ctx, url, options) => {
      assert.equal(url, 'https://zwid.api.zalo.me/api/znoise');
      assert.equal(options.method, 'POST');
      const params = JSON.parse(options.body.get('params'));
      assert.deepEqual(params, { fids: [123456789], gids: [987654321] });
      return { ok: true, status: 200, json: async () => ({ error_code: 0,
        data: JSON.stringify({ error_code: 0, data: {
          fids: ['1234567890123456789'], gids: ['9876543210123456789']
        } }) }) };
    }
  };
  const result = await requestNoisedIds({ ctx, utils,
    sessionCookies: [{ key: 'zpw_sek', value: 'secret', domain: 'chat.zalo.me' }],
    threads: [{ plainId: '123456789', isGroup: false }, { plainId: '987654321', isGroup: true }] });
  assert.equal(cookie.includes('Domain=.zalo.me'), true);
  assert.deepEqual(result, [
    { plainId: '123456789', noisedId: '1234567890123456789', isGroup: false },
    { plainId: '987654321', noisedId: '9876543210123456789', isGroup: true }
  ]);
});

test('profile lookup names mapped people and groups without treating strangers as friends', async () => {
  const api = {
    getUserInfo: async ids => ({ changed_profiles: {
      [ids[0]]: { userId: ids[0], displayName: 'Người liên hệ', avatar: 'person-avatar' }
    } }),
    getGroupInfo: async ids => ({ gridInfoMap: {
      [ids[0]]: { groupId: ids[0], name: 'Tên nhóm', avt: 'group-avatar' }
    } })
  };
  const mappings = [
    { plainId: '123456789', noisedId: '1234567890123456789', isGroup: false },
    { plainId: '987654321', noisedId: '9876543210123456789', isGroup: true }
  ];
  const profiles = await fetchThreadProfiles({ api, mappings, friends: [], groups: {} });
  assert.deepEqual(profiles, [
    { ...mappings[0], name: 'Người liên hệ', avatar: 'person-avatar' },
    { ...mappings[1], name: 'Tên nhóm', avatar: 'group-avatar' }
  ]);
});
