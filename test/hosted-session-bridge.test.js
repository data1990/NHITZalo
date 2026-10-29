const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrigin, HostedSessionBridge } = require('../src/main/hostedSessionBridge');

test('requires HTTPS except loopback development', () => {
  assert.equal(normalizeOrigin('https://example.com/'), 'https://example.com');
  assert.throws(() => normalizeOrigin('http://example.com'));
  assert.equal(normalizeOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
});

test('downloads and uploads session with bearer token', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () =>
      options.method === 'GET' ? { session: { imei: 'a', cookie: ['b'] } } : { success: true } };
  };
  const bridge = new HostedSessionBridge({ origin: 'https://example.com', token: 'a'.repeat(64), fetcher });
  assert.deepEqual(await bridge.download(), { imei: 'a', cookie: ['b'] });
  await bridge.upload({ imei: 'a', cookie: ['b'] });
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(JSON.parse(calls[1].options.body).session.imei, 'a');
});

test('rejects unexpected HTML response without exposing it', async () => {
  const bridge = new HostedSessionBridge({ origin: 'https://example.com', token: 'a'.repeat(64),
    fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('HTML'); } }) });
  await assert.rejects(bridge.download(), /JSON hợp lệ/);
});

test('exchanges one-time code for a scoped device token', async () => {
  let request;
  const bridge = await HostedSessionBridge.pair('https://example.com', 'ABCDEF123456', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ token: 'c'.repeat(64) }) };
  });
  assert.equal(bridge.token, 'c'.repeat(64));
  assert.equal(request.url, 'https://example.com/api.php?action=device-pair');
  assert.deepEqual(JSON.parse(request.options.body), { code: 'ABCDEF123456' });
});

test('preserves authorization failure status for local-session fallback decision', async () => {
  const bridge = new HostedSessionBridge({ origin: 'https://example.com', token: 'a'.repeat(64),
    fetcher: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Thiết bị đã bị thu hồi' }) }) });
  await assert.rejects(bridge.download(), error => error.status === 401 && /thu hồi/.test(error.message));
});

test('checks PHP and database availability before device pairing', async () => {
  let request;
  const result = await HostedSessionBridge.checkOrigin('https://example.com/', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true, database: true }) };
  });
  assert.deepEqual(result, { origin: 'https://example.com', ok: true, database: true });
  assert.equal(request.url, 'https://example.com/api.php?action=health');
  assert.equal(request.options.method, 'GET');
});

test('server check reports a PHP or database failure', async () => {
  await assert.rejects(HostedSessionBridge.checkOrigin('https://example.com', async () => ({
    ok: false, status: 503, json: async () => ({ error: 'Không kết nối được MySQL' })
  })), /MySQL/);
});

test('web login requests a scoped device session without retaining password', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => calls.length === 1
      ? { accounts: [{ id: 7, label: 'Công việc' }, { id: 8, label: 'Gia đình' }] }
      : { account: { id: 8, label: 'Gia đình' }, token: 'd'.repeat(64) } };
  };
  const first = await HostedSessionBridge.login('https://example.com', 'member', 'secret-pass', null, fetcher);
  assert.equal(first.accounts.length, 2);
  const selected = await HostedSessionBridge.login('https://example.com', 'member', 'secret-pass', 8, fetcher);
  assert.equal(selected.account.id, 8);
  assert.equal(selected.bridge.token, 'd'.repeat(64));
  assert.equal(calls[0].url, 'https://example.com/api.php?action=desktop-login');
  assert.equal(JSON.parse(calls[1].options.body).account_id, 8);
  assert.equal(calls[0].options.redirect, 'error');
});

test('web registration calls the existing approval-based PHP endpoint', async () => {
  let request;
  const result = await HostedSessionBridge.register('https://zalo.ngochoangit.net', 'newuser', 'a-long-password',
    async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ success: true, message: 'Đã đăng ký, chờ admin duyệt' }) };
    });
  assert.equal(result.message, 'Đã đăng ký, chờ admin duyệt');
  assert.equal(request.url, 'https://zalo.ngochoangit.net/api.php?action=register');
  assert.deepEqual(JSON.parse(request.options.body), { username: 'newuser', password: 'a-long-password' });
  await assert.rejects(HostedSessionBridge.register('https://zalo.ngochoangit.net', 'bad name', 'a-long-password'), /Tên đăng nhập/);
});
