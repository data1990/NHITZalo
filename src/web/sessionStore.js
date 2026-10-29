const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class WebSessionStore {
  constructor(directory, password) {
    if (typeof password !== 'string' || password.length < 12) {
      throw new Error('Mật khẩu quản trị web phải có ít nhất 12 ký tự');
    }
    this.directory = directory;
    this.file = path.join(directory, 'accounts.json');
    this.sessionsDir = path.join(directory, 'sessions');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.data = { version: 2, salt: crypto.randomBytes(32).toString('base64'),
        verifier: null, accounts: [] };
    }
    this.key = crypto.scryptSync(password, Buffer.from(this.data.salt, 'base64'), 32);
    if (this.data.verifier) {
      try {
        if (this.decrypt(this.data.verifier, 'web-admin') !== 'NHITZalo web session store') {
          throw new Error('Invalid verifier');
        }
      } catch (_) { throw new Error('Mật khẩu quản trị web không đúng'); }
    } else {
      this.data.verifier = this.encrypt('NHITZalo web session store', 'web-admin');
      this.persist();
    }
    if (this.data.version === 1) this.migrateCombinedSessions();
  }

  sessionPath(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error('ID tài khoản không hợp lệ');
    return path.join(this.sessionsDir, `${id}.json`);
  }

  writeSessionFile(id, encrypted) {
    const target = this.sessionPath(id);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(encrypted), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, target);
  }

  migrateCombinedSessions() {
    for (const account of this.data.accounts) {
      if (account.session && !fs.existsSync(this.sessionPath(account.id))) {
        this.writeSessionFile(account.id, account.session);
      }
      delete account.session;
    }
    this.data.version = 2;
    this.persist();
  }

  encrypt(value, context) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return { iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'),
      tag: cipher.getAuthTag().toString('base64') };
  }

  decrypt(value, context) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()
    ]).toString('utf8'));
  }

  persist() {
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  listAccounts() {
    return this.data.accounts.map(account => ({ id: account.id, label: account.label,
      hasSession: fs.existsSync(this.sessionPath(account.id)) }));
  }

  find(id) {
    const account = this.data.accounts.find(item => item.id === id);
    if (!account) throw new Error('Không tìm thấy tài khoản web');
    return account;
  }

  createAccount(label) {
    const clean = String(label || '').trim().slice(0, 80);
    if (!clean) throw new Error('Hãy nhập tên tài khoản');
    const account = { id: crypto.randomUUID(), label: clean };
    this.data.accounts.push(account);
    this.persist();
    return { id: account.id, label: account.label, hasSession: false };
  }

  saveSession(id, session) {
    if (!session?.imei || !Array.isArray(session?.cookie)) throw new Error('Phiên Zalo không hợp lệ');
    this.find(id);
    this.writeSessionFile(id, this.encrypt(session, id));
  }

  loadSession(id) {
    this.find(id);
    const file = this.sessionPath(id);
    return fs.existsSync(file) ? this.decrypt(JSON.parse(fs.readFileSync(file, 'utf8')), id) : null;
  }

  removeSession(id) {
    this.find(id);
    try { fs.unlinkSync(this.sessionPath(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  deleteAccount(id) {
    this.find(id);
    this.data.accounts = this.data.accounts.filter(item => item.id !== id);
    this.persist();
    try { fs.unlinkSync(this.sessionPath(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

module.exports = WebSessionStore;
