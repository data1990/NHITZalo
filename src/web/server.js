const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const WebSessionStore = require('./sessionStore');
const WebZaloSessions = require('./zaloSessions');

const WEB_ROOT = path.join(__dirname, 'public');
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'] };

function resolveAdminPassword(environment = process.env) {
  if (environment.WEB_ADMIN_PASSWORD) return environment.WEB_ADMIN_PASSWORD;
  const credentialFile = environment.WEB_ADMIN_PASSWORD_FILE ||
    (environment.CREDENTIALS_DIRECTORY
      ? path.join(environment.CREDENTIALS_DIRECTORY, 'nhitzalo_admin_password') : '');
  return credentialFile ? fs.readFileSync(credentialFile, 'utf8').replace(/\r?\n$/, '') : '';
}

function createWebServer({ dataDir, password, publicOrigin, store, sessions } = {}) {
  if (!password || password.length < 12) throw new Error('Đặt WEB_ADMIN_PASSWORD dài ít nhất 12 ký tự');
  const root = dataDir || path.join(process.env.APPDATA || path.join(os.homedir(), '.local', 'share'), 'nhitzalo-web-host');
  const sessionStore = store || new WebSessionStore(root, password);
  const zaloSessions = sessions || new WebZaloSessions(sessionStore);
  const loginTokens = new Map();
  const failures = new Map();
  const passwordHash = crypto.createHash('sha256').update(password).digest();

  const server = http.createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    };
    const send = (status, body, extra = {}) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      response.end(JSON.stringify(body));
    };
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/favicon.ico') {
        response.writeHead(204, headers);
        response.end();
        return;
      }
      if (request.method === 'GET' && FILES[pathname]) {
        const [name, type] = FILES[pathname];
        response.writeHead(200, { ...headers, 'Content-Type': type });
        response.end(fs.readFileSync(path.join(WEB_ROOT, name)));
        return;
      }
      if (!pathname.startsWith('/api/')) return send(404, { error: 'Không tìm thấy trang' });

      const cookie = String(request.headers.cookie || '').split(';').map(value => value.trim())
        .find(value => value.startsWith('nhitzalo_web='))?.slice('nhitzalo_web='.length);
      const login = cookie && loginTokens.get(cookie);
      if (login && login.expires < Date.now()) loginTokens.delete(cookie);
      const authenticated = login && login.expires >= Date.now();

      if (request.method === 'POST') {
        const expectedOrigin = publicOrigin || `http://${request.headers.host}`;
        if (request.headers.origin !== expectedOrigin) return send(403, { error: 'Nguồn yêu cầu không hợp lệ' });
      }

      const readBody = async () => {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16384) throw new Error('Dữ liệu gửi lên quá lớn');
        }
        return body ? JSON.parse(body) : {};
      };

      if (pathname === '/api/login' && request.method === 'POST') {
        const ip = request.socket.remoteAddress || '';
        const attempt = failures.get(ip) || { count: 0, until: 0 };
        if (attempt.until > Date.now()) return send(429, { error: 'Thử lại sau 15 phút' });
        const input = await readBody();
        const hash = crypto.createHash('sha256').update(String(input.password || '')).digest();
        if (!crypto.timingSafeEqual(hash, passwordHash)) {
          attempt.count++;
          if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
          failures.set(ip, attempt);
          return send(401, { error: 'Mật khẩu quản trị không đúng' });
        }
        failures.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const csrf = crypto.randomBytes(32).toString('hex');
        loginTokens.set(token, { csrf, expires: Date.now() + 8 * 60 * 60 * 1000 });
        const secure = publicOrigin?.startsWith('https://') ? '; Secure' : '';
        return send(200, { success: true, csrf }, { 'Set-Cookie':
          `nhitzalo_web=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
      }

      if (!authenticated) return send(401, { error: 'Cần đăng nhập quản trị' });
      if (request.method === 'POST' && request.headers['x-csrf-token'] !== login.csrf) {
        return send(403, { error: 'Yêu cầu thiếu mã bảo vệ' });
      }
      if (pathname === '/api/me' && request.method === 'GET') return send(200, { csrf: login.csrf });
      if (pathname === '/api/logout' && request.method === 'POST') {
        loginTokens.delete(cookie);
        return send(200, { success: true }, { 'Set-Cookie':
          'nhitzalo_web=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (pathname === '/api/accounts' && request.method === 'GET') {
        const accounts = await sessionStore.listAccounts();
        return send(200, { accounts: await Promise.all(accounts.map(async account => ({
          ...account, ...await zaloSessions.getStatus(account.id)
        }))) });
      }
      if (pathname === '/api/accounts' && request.method === 'POST') {
        const { label } = await readBody();
        return send(201, { account: await sessionStore.createAccount(label) });
      }
      const action = pathname.match(/^\/api\/accounts\/([0-9a-f-]{36})\/(qr|session|delete)$/i);
      if (action && request.method === 'POST') {
        const [, id, command] = action;
        if (command === 'qr') return send(200, await zaloSessions.startQR(id));
        if (command === 'session') {
          await zaloSessions.removeSession(id);
          return send(200, { success: true });
        }
        await zaloSessions.deleteAccount(id);
        return send(200, { success: true });
      }
      return send(404, { error: 'Không tìm thấy API' });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : /Không tìm thấy|không hợp lệ|Hãy nhập/.test(error.message) ? 400 : 500;
      return send(status, { error: status === 500 ? 'Lỗi máy chủ' : error.message });
    }
  });
  server.zaloSessions = zaloSessions;
  return server;
}

if (require.main === module) {
  const host = process.env.WEB_HOST || '127.0.0.1';
  const port = Number(process.env.WEB_PORT || 3177);
  const password = resolveAdminPassword();
  const publicOrigin = process.env.WEB_PUBLIC_ORIGIN || `http://${host}:${port}`;
  try {
    if (host !== '127.0.0.1' && host !== 'localhost' && !publicOrigin.startsWith('https://')) {
      throw new Error('Truy cập từ xa cần WEB_PUBLIC_ORIGIN dạng HTTPS');
    }
    const server = createWebServer({ password, dataDir: process.env.WEB_DATA_DIR, publicOrigin });
    server.listen(port, host, () => {
      console.log(`NHIT Zalo web host: ${publicOrigin}`);
      server.zaloSessions.resumeAll().catch(error => console.warn('Không thể khôi phục phiên:', error.message));
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createWebServer, resolveAdminPassword };
