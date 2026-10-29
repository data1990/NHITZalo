const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

function normalizeOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Địa chỉ hosting không hợp lệ');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Hosting cần HTTPS');
  }
  return url.origin;
}

class HostedSessionBridge {
  static async register(origin, username, password, fetcher = fetch) {
    const base = normalizeOrigin(origin);
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,40}$/.test(cleanUsername)) throw new Error('Tên đăng nhập cần 3–40 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang');
    if (typeof password !== 'string' || password.length < 12) throw new Error('Mật khẩu web phải có ít nhất 12 ký tự');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(`${base}/api.php?action=register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password }), signal: controller.signal,
        redirect: 'error', cache: 'no-store'
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('Hosting không trả về JSON hợp lệ; kiểm tra PHP và đường dẫn website'); }
      if (!response.ok || !data.success) throw new Error(data.error || `Đăng ký thất bại (HTTP ${response.status})`);
      return { message: data.message || 'Đã gửi đăng ký; chờ admin duyệt tài khoản' };
    } finally { clearTimeout(timeout); }
  }

  static async login(origin, username, password, accountId = null, fetcher = fetch) {
    const base = normalizeOrigin(origin);
    if (!String(username || '').trim() || !String(password || '')) throw new Error('Nhập tên đăng nhập và mật khẩu web');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(`${base}/api.php?action=desktop-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: String(username).trim(), password: String(password),
          account_id: accountId == null ? null : Number(accountId) }),
        signal: controller.signal, redirect: 'error', cache: 'no-store'
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('Hosting không trả về JSON hợp lệ; kiểm tra PHP và đường dẫn website'); }
      if (!response.ok) throw new Error(data.error || `Đăng nhập web thất bại (HTTP ${response.status})`);
      if (data.token) {
        if (!data.account || !Number.isSafeInteger(Number(data.account.id))) throw new Error('Hosting trả về tài khoản không hợp lệ');
        return { account: data.account, bridge: new HostedSessionBridge({ origin: base, token: data.token }) };
      }
      if (!Array.isArray(data.accounts)) throw new Error('Hosting trả về danh sách tài khoản không hợp lệ');
      return { accounts: data.accounts };
    } finally { clearTimeout(timeout); }
  }

  static async checkOrigin(origin, fetcher = fetch) {
    const base = normalizeOrigin(origin);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(`${base}/api.php?action=health`, {
        method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal,
        redirect: 'error', cache: 'no-store'
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('Hosting không trả về JSON; kiểm tra PHP và đường dẫn website'); }
      if (!response.ok || !data.ok || !data.database) throw new Error(data.error || `Hosting trả HTTP ${response.status}`);
      return { origin: base, ok: true, database: true };
    } finally { clearTimeout(timeout); }
  }

  static async pair(origin, code, fetcher = fetch) {
    const base = normalizeOrigin(origin);
    if (!/^[A-Z0-9]{12}$/.test(String(code || '').toUpperCase())) throw new Error('Mã ghép nối cần 12 ký tự');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetcher(`${base}/api.php?action=device-pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code: String(code).toUpperCase() }), redirect: 'error', cache: 'no-store', signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('Hosting không trả về JSON hợp lệ'); }
    if (!response.ok || !data.token) throw new Error(data.error || `Ghép nối thất bại (HTTP ${response.status})`);
    return new HostedSessionBridge({ origin: base, token: data.token });
  }

  constructor({ origin, token, fetcher = fetch }) {
    this.origin = normalizeOrigin(origin);
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Mã ghép nối không hợp lệ');
    this.token = token;
    this.fetcher = fetcher;
  }

  static load(directory) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(directory, 'hosted_session_bridge.json'), 'utf8'));
      if (saved.version !== 1 || !safeStorage.isEncryptionAvailable()) return null;
      const token = safeStorage.decryptString(Buffer.from(saved.tokenCipher, 'base64'));
      return new HostedSessionBridge({ origin: saved.origin, token });
    } catch (_) { return null; }
  }

  static save(directory, origin, token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Máy chưa hỗ trợ mã hóa khóa ghép nối');
    const bridge = new HostedSessionBridge({ origin, token });
    const tokenCipher = safeStorage.encryptString(token).toString('base64');
    fs.writeFileSync(path.join(directory, 'hosted_session_bridge.json'), JSON.stringify({ version: 1, origin: bridge.origin, tokenCipher }), { mode: 0o600 });
    return bridge;
  }

  async request(action, method = 'GET', body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(`${this.origin}/api.php?action=${encodeURIComponent(action)}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        redirect: 'error', cache: 'no-store'
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error('Hosting không trả về JSON hợp lệ; kiểm tra cấu hình PHP'); }
      if (!response.ok) {
        const error = new Error(data.error || `Hosting trả HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }

  async download() { return (await this.request('device-session')).session || null; }
  async upload(session) { return this.request('device-session', 'PUT', { session }); }
  async clear() { return this.request('device-session', 'DELETE'); }
  async revoke() { return this.request('device-revoke', 'POST'); }
  async status() { return this.request('device-status'); }
}

module.exports = { normalizeOrigin, HostedSessionBridge };
