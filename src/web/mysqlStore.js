const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class MySqlStore {
  constructor(pool, password) {
    if (typeof password !== 'string' || password.length < 12) {
      throw new Error('Mật khẩu quản trị web phải có ít nhất 12 ký tự');
    }
    this.pool = pool;
    this.password = password;
  }

  static async open(pool, password) {
    const store = new MySqlStore(pool, password);
    await store.initialize();
    return store;
  }

  encrypt(value, context) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64') });
  }

  decrypt(payload, context) {
    const value = JSON.parse(payload);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()
    ]).toString('utf8'));
  }

  async initialize() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS web_meta (id TINYINT PRIMARY KEY, salt VARCHAR(64) NOT NULL, verifier TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await this.pool.query('CREATE TABLE IF NOT EXISTS web_users (id CHAR(36) PRIMARY KEY, username VARCHAR(40) NOT NULL UNIQUE, password_salt VARCHAR(64) NOT NULL, password_hash VARCHAR(64) NOT NULL, role VARCHAR(16) NOT NULL, approved TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await this.pool.query('CREATE TABLE IF NOT EXISTS web_accounts (id CHAR(36) PRIMARY KEY, owner_id CHAR(36) NOT NULL, label VARCHAR(80) NOT NULL, session_cipher LONGTEXT NULL, INDEX(owner_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    const salt = crypto.randomBytes(32).toString('base64');
    this.key = crypto.scryptSync(this.password, Buffer.from(salt, 'base64'), 32);
    await this.pool.execute('INSERT IGNORE INTO web_meta (id, salt, verifier) VALUES (1, ?, ?)',
      [salt, this.encrypt('NHITZalo web session store', 'web-admin')]);
    const [rows] = await this.pool.execute('SELECT salt, verifier FROM web_meta WHERE id = 1');
    this.key = crypto.scryptSync(this.password, Buffer.from(rows[0].salt, 'base64'), 32);
    try {
      if (this.decrypt(rows[0].verifier, 'web-admin') !== 'NHITZalo web session store') throw new Error('Invalid verifier');
    } catch (_) { throw new Error('Mật khẩu quản trị web không đúng với database'); }
    const [admins] = await this.pool.execute('SELECT id FROM web_users WHERE username = ?', ['admin']);
    if (!admins.length) await this.insertUser('admin', this.password, 'admin', true);
  }

  async insertUser(username, password, role, approved) {
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(32).toString('base64');
    const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32).toString('base64');
    await this.pool.execute('INSERT INTO web_users (id, username, password_salt, password_hash, role, approved) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username, salt, hash, role, approved ? 1 : 0]);
    return { id, username, role, approved: Boolean(approved) };
  }

  async registerUser(username, password) {
    const clean = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,40}$/.test(clean)) throw new Error('Tên đăng nhập cần 3–40 ký tự a-z, 0-9, _, . hoặc -');
    if (typeof password !== 'string' || password.length < 12) throw new Error('Mật khẩu phải có ít nhất 12 ký tự');
    try { return await this.insertUser(clean, password, 'user', false); }
    catch (error) { if (error.code === 'ER_DUP_ENTRY') throw new Error('Tên đăng nhập đã tồn tại'); throw error; }
  }

  async authenticate(username, password) {
    const [rows] = await this.pool.execute('SELECT id, username, password_salt, password_hash, role, approved FROM web_users WHERE username = ?',
      [String(username || '').trim().toLowerCase()]);
    const user = rows[0];
    if (!user || typeof password !== 'string') return null;
    const actual = crypto.scryptSync(password, Buffer.from(user.password_salt, 'base64'), 32);
    const expected = Buffer.from(user.password_hash, 'base64');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    return { id: user.id, username: user.username, role: user.role, approved: Boolean(user.approved) };
  }

  async getUser(id) {
    const [rows] = await this.pool.execute('SELECT id, username, role, approved FROM web_users WHERE id = ?', [id]);
    const user = rows[0];
    return user ? { ...user, approved: Boolean(user.approved) } : null;
  }

  async listPendingUsers() {
    const [rows] = await this.pool.execute('SELECT id, username, role, approved FROM web_users WHERE approved = 0 AND role = ?', ['user']);
    return rows.map(user => ({ ...user, approved: false }));
  }

  async approveUser(id) {
    const [result] = await this.pool.execute('UPDATE web_users SET approved = 1 WHERE id = ? AND role = ?', [id, 'user']);
    if (!result.affectedRows) throw new Error('Không tìm thấy người dùng đang chờ duyệt');
  }

  async listAccounts(ownerId) {
    const [rows] = await this.pool.execute('SELECT id, label, owner_id, session_cipher IS NOT NULL AS hasSession FROM web_accounts' +
      (ownerId ? ' WHERE owner_id = ?' : '') + ' ORDER BY label', ownerId ? [ownerId] : []);
    return rows.map(row => ({ id: row.id, label: row.label, ownerId: row.ownerId || row.owner_id,
      hasSession: Boolean(row.hasSession) }));
  }

  async find(id) {
    const [rows] = await this.pool.execute('SELECT id, label, owner_id FROM web_accounts WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Không tìm thấy tài khoản web');
    return { id: rows[0].id, label: rows[0].label, ownerId: rows[0].ownerId || rows[0].owner_id };
  }

  async createAccount(label, ownerId) {
    const clean = String(label || '').trim().slice(0, 80);
    if (!clean) throw new Error('Hãy nhập tên tài khoản');
    if (!ownerId) throw new Error('Thiếu người sở hữu tài khoản');
    const account = { id: crypto.randomUUID(), label: clean, ownerId, hasSession: false };
    await this.pool.execute('INSERT INTO web_accounts (id, owner_id, label) VALUES (?, ?, ?)',
      [account.id, ownerId, clean]);
    return account;
  }

  async saveSession(id, session) {
    if (!session?.imei || !Array.isArray(session?.cookie)) throw new Error('Phiên Zalo không hợp lệ');
    await this.find(id);
    await this.pool.execute('UPDATE web_accounts SET session_cipher = ? WHERE id = ?', [this.encrypt(session, id), id]);
  }

  async loadSession(id) {
    await this.find(id);
    const [rows] = await this.pool.execute('SELECT session_cipher FROM web_accounts WHERE id = ?', [id]);
    return rows[0].session_cipher ? this.decrypt(rows[0].session_cipher, id) : null;
  }

  async removeSession(id) {
    await this.find(id);
    await this.pool.execute('UPDATE web_accounts SET session_cipher = NULL WHERE id = ?', [id]);
  }

  async deleteAccount(id) {
    await this.find(id);
    await this.pool.execute('DELETE FROM web_accounts WHERE id = ?', [id]);
  }

  async importLegacy(directory) {
    const file = path.join(directory, 'accounts.json');
    if (!fs.existsSync(file)) return;
    const WebSessionStore = require('./sessionStore');
    const old = new WebSessionStore(directory, this.password);
    const [admins] = await this.pool.execute('SELECT id FROM web_users WHERE username = ?', ['admin']);
    const ownerId = admins[0].id;
    for (const account of old.listAccounts()) {
      await this.pool.execute('INSERT IGNORE INTO web_accounts (id, owner_id, label) VALUES (?, ?, ?)',
        [account.id, ownerId, account.label]);
      if (account.hasSession && !(await this.loadSession(account.id))) {
        await this.saveSession(account.id, old.loadSession(account.id));
      }
    }
    fs.renameSync(file, `${file}.migrated`);
  }
}

module.exports = MySqlStore;
