const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebZaloSessions = require('./zaloSessions');

const PUBLIC = path.join(__dirname, fs.existsSync(path.join(__dirname, 'hostedPublic')) ? 'hostedPublic' : 'public');
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'] };

function readSecret(environment, name) {
  if (environment[name]) return environment[name];
  const file = environment[`${name}_FILE`];
  return file ? fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '') : '';
}

function createHostedServer({ store, sessions, publicOrigin } = {}) {
  if (!store) throw new Error('Thiếu database store');
  const zaloSessions = sessions || new WebZaloSessions(store);
  const tokens = new Map();
  const failures = new Map();
  const server = http.createServer(async (request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
    const send = (status, body, extra = {}) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      response.end(JSON.stringify(body));
    };
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && pathname === '/api/health') return send(200, { ok: true });
      if (request.method === 'GET' && FILES[pathname]) {
        const [name, type] = FILES[pathname];
        response.writeHead(200, { ...headers, 'Content-Type': type });
        response.end(fs.readFileSync(path.join(PUBLIC, name)));
        return;
      }
      if (request.method === 'GET' && pathname === '/favicon.ico') {
        response.writeHead(204, headers); response.end(); return;
      }
      if (!pathname.startsWith('/api/')) return send(404, { error: 'Không tìm thấy trang' });
      if (request.method === 'POST' && request.headers.origin !== (publicOrigin || `http://${request.headers.host}`)) {
        return send(403, { error: 'Nguồn yêu cầu không hợp lệ' });
      }
      const readBody = async () => {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16384) throw new Error('Dữ liệu gửi lên quá lớn');
        }
        return body ? JSON.parse(body) : {};
      };
      if (pathname === '/api/register' && request.method === 'POST') {
        const { username, password } = await readBody();
        const user = await store.registerUser(username, password);
        return send(201, { id: user.id, message: 'Đã đăng ký. Chờ quản trị viên duyệt.' });
      }
      if (pathname === '/api/login' && request.method === 'POST') {
        const ip = request.socket.remoteAddress || '';
        const attempt = failures.get(ip) || { count: 0, until: 0 };
        if (attempt.until > Date.now()) return send(429, { error: 'Thử lại sau 15 phút' });
        const { username, password } = await readBody();
        const user = await store.authenticate(username, password);
        if (!user) {
          attempt.count++;
          if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
          failures.set(ip, attempt);
          return send(401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        if (!user.approved) return send(403, { error: 'Tài khoản đang chờ quản trị viên duyệt' });
        failures.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const csrf = crypto.randomBytes(32).toString('hex');
        tokens.set(token, { userId: user.id, csrf, expires: Date.now() + 8 * 60 * 60 * 1000 });
        const secure = publicOrigin?.startsWith('https://') ? '; Secure' : '';
        return send(200, { csrf, user: { username: user.username, role: user.role } }, {
          'Set-Cookie': `nhitzalo_web=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`
        });
      }
      const cookie = String(request.headers.cookie || '').split(';').map(value => value.trim())
        .find(value => value.startsWith('nhitzalo_web='))?.slice('nhitzalo_web='.length);
      const login = cookie && tokens.get(cookie);
      if (!login || login.expires < Date.now()) return send(401, { error: 'Cần đăng nhập' });
      const user = await store.getUser(login.userId);
      if (!user || !user.approved) return send(403, { error: 'Tài khoản chưa được duyệt' });
      if (request.method === 'POST' && request.headers['x-csrf-token'] !== login.csrf) {
        return send(403, { error: 'Yêu cầu thiếu mã bảo vệ' });
      }
      if (pathname === '/api/me' && request.method === 'GET') return send(200, {
        csrf: login.csrf, user: { username: user.username, role: user.role }
      });
      if (pathname === '/api/logout' && request.method === 'POST') {
        tokens.delete(cookie);
        return send(200, { success: true }, { 'Set-Cookie':
          'nhitzalo_web=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (pathname === '/api/admin/pending' && request.method === 'GET') {
        if (user.role !== 'admin') return send(403, { error: 'Chỉ quản trị viên được duyệt tài khoản' });
        return send(200, { users: await store.listPendingUsers() });
      }
      const approval = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/approve$/i);
      if (approval && request.method === 'POST') {
        if (user.role !== 'admin') return send(403, { error: 'Chỉ quản trị viên được duyệt tài khoản' });
        await store.approveUser(approval[1]);
        return send(200, { success: true });
      }
      if (pathname === '/api/accounts' && request.method === 'GET') {
        const accounts = await store.listAccounts(user.id);
        return send(200, { accounts: await Promise.all(accounts.map(async account => ({
          ...account, ...await zaloSessions.getStatus(account.id)
        }))) });
      }
      if (pathname === '/api/accounts' && request.method === 'POST') {
        const { label } = await readBody();
        return send(201, { account: await store.createAccount(label, user.id) });
      }
      const action = pathname.match(/^\/api\/accounts\/([0-9a-f-]{36})\/(qr|session|delete)$/i);
      if (action && request.method === 'POST') {
        const [, id, command] = action;
        const account = await store.find(id);
        if (account.ownerId !== user.id) return send(403, { error: 'Tài khoản Zalo không thuộc người dùng này' });
        if (command === 'qr') return send(200, await zaloSessions.startQR(id));
        if (command === 'session') { await zaloSessions.removeSession(id); return send(200, { success: true }); }
        await zaloSessions.deleteAccount(id);
        return send(200, { success: true });
      }
      return send(404, { error: 'Không tìm thấy API' });
    } catch (error) {
      const badInput = error instanceof SyntaxError || /không hợp lệ|Hãy nhập|phải có|đã tồn tại|không tìm thấy|cần 3|quá lớn/i.test(error.message);
      if (!badInput) console.error('Hosted API error:', error);
      return send(badInput ? 400 : 500, { error: badInput ? error.message : 'Lỗi máy chủ' });
    }
  });
  server.zaloSessions = zaloSessions;
  return server;
}

if (require.main === module) {
  (async () => {
    const mysql = require('mysql2/promise');
    const MySqlStore = require('./mysqlStore');
    const password = readSecret(process.env, 'WEB_ADMIN_PASSWORD');
    const dbPassword = readSecret(process.env, 'WEB_DB_PASSWORD');
    if (!process.env.WEB_PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('WEB_PUBLIC_ORIGIN cần là domain HTTPS');
    if (!process.env.WEB_DB_USER || !process.env.WEB_DB_NAME) throw new Error('Thiếu WEB_DB_USER hoặc WEB_DB_NAME');
    const pool = mysql.createPool({ host: process.env.WEB_DB_HOST || '127.0.0.1',
      port: Number(process.env.WEB_DB_PORT || 3306), user: process.env.WEB_DB_USER,
      password: dbPassword, database: process.env.WEB_DB_NAME,
      waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4' });
    const store = await MySqlStore.open(pool, password);
    if (process.env.WEB_DATA_DIR) await store.importLegacy(process.env.WEB_DATA_DIR);
    const server = createHostedServer({ store, publicOrigin: process.env.WEB_PUBLIC_ORIGIN });
    const port = Number(process.env.WEB_PORT || 3177);
    server.listen(port, process.env.WEB_HOST || '127.0.0.1', () => {
      console.log(`NHIT Zalo hosted web: ${process.env.WEB_PUBLIC_ORIGIN}`);
      server.zaloSessions.resumeAll().catch(error => console.error('Không thể khôi phục phiên Zalo:', error));
    });
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { createHostedServer, readSecret };
