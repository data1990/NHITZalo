const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGACY_FILES = [
  'zalo_session.json', 'zalo_messages.json', 'zalo_messages.sqlite',
  'zalo_messages.sqlite-wal', 'zalo_messages.sqlite-shm',
  'zalo_groups.json', 'zalo_friends.json', 'zalo_pinned.json',
  'zalo_muted.json', 'zalo_read.json', 'sync-download-diagnostics.log',
  'bubble_pos.json'
];
const LEGACY_ACCOUNT_FILES = LEGACY_FILES.filter(name => name.startsWith('zalo_'));

class AccountRegistry {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'accounts.json');
    fs.mkdirSync(root, { recursive: true });
    this.accounts = this.read();
    if (!this.accounts.some(account => account.originLegacy) &&
        LEGACY_ACCOUNT_FILES.some(name => fs.existsSync(path.join(root, name)))) {
      this.accounts.push({ id: crypto.randomUUID(), name: 'Tài khoản Zalo hiện tại',
        salt: null, hash: null, legacy: true, originLegacy: true, createdAt: Date.now() });
      this.save();
    }
  }

  read() {
    if (!fs.existsSync(this.file)) return [];
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    return Array.isArray(value.accounts) ? value.accounts : [];
  }

  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, accounts: this.accounts }, null, 2));
    fs.renameSync(temp, this.file);
  }

  public(account) {
    return { id: account.id, name: account.zaloName || account.name,
      needsPassword: !account.hash && !account.passwordOptional,
      requiresPassword: !!account.hash,
      originLegacy: !!account.originLegacy,
      hasSession: fs.existsSync(path.join(this.dataDir(account.id), 'zalo_session.json')) ||
        (account.legacy && fs.existsSync(path.join(this.root, 'zalo_session.json'))) };
  }

  list() { return this.accounts.map(account => this.public(account)); }

  readZaloName(sessionPath, safeStorage) {
    try {
      if (!fs.existsSync(sessionPath)) return '';
      const saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      const session = saved?.version === 2 && saved.ciphertext
        ? (safeStorage?.isEncryptionAvailable()
          ? JSON.parse(safeStorage.decryptString(Buffer.from(saved.ciphertext, 'base64')))
          : null)
        : saved;
      const info = session?.userInfo;
      const name = String(info?.name || info?.displayName || info?.zaloName || '').trim();
      return name === 'Người dùng Zalo' ? '' : name.slice(0, 80);
    } catch (_) {
      return '';
    }
  }

  refreshZaloNames(safeStorage) {
    let changed = false;
    for (const account of this.accounts) {
      const profileSession = path.join(this.dataDir(account.id), 'zalo_session.json');
      const sessionPath = account.legacy && !fs.existsSync(profileSession)
        ? path.join(this.root, 'zalo_session.json') : profileSession;
      const name = this.readZaloName(sessionPath, safeStorage);
      if (name && name !== account.zaloName) { account.zaloName = name; changed = true; }
    }
    if (changed) this.save();
    return this.list();
  }

  setZaloName(id, name) {
    const account = this.accounts.find(item => item.id === id);
    const clean = String(name || '').trim().slice(0, 80);
    if (!account || !clean || clean === 'Người dùng Zalo') return null;
    if (account.zaloName !== clean) { account.zaloName = clean; this.save(); }
    return this.public(account);
  }

  dataDir(id) {
    if (!this.accounts.some(account => account.id === id)) throw new Error('Không tìm thấy tài khoản');
    return path.join(this.root, 'accounts', id);
  }

  assertPassword(password) {
    if (typeof password !== 'string' || password.length < 6) {
      throw new Error('Mật khẩu phải có ít nhất 6 ký tự');
    }
  }

  setHash(account, password) {
    this.assertPassword(password);
    account.salt = crypto.randomBytes(16).toString('hex');
    account.hash = crypto.scryptSync(password, Buffer.from(account.salt, 'hex'), 64).toString('hex');
    account.passwordOptional = false;
  }

  create(name, password) {
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) throw new Error('Nhập tên để nhận biết tài khoản');
    const account = { id: crypto.randomUUID(), name: cleanName, createdAt: Date.now() };
    if (password) this.setHash(account, password);
    else account.passwordOptional = true;
    this.accounts.push(account);
    fs.mkdirSync(this.dataDir(account.id), { recursive: true });
    this.save();
    return this.public(account);
  }

  verify(id, password) {
    const account = this.accounts.find(item => item.id === id);
    if (!account || typeof password !== 'string') return null;
    if (account.passwordOptional && !account.hash) return password === '' ? this.public(account) : null;
    if (!account.hash) return null;
    const supplied = crypto.scryptSync(password, Buffer.from(account.salt, 'hex'), 64);
    const expected = Buffer.from(account.hash, 'hex');
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)
      ? this.public(account) : null;
  }

  setInitialPassword(id, password) {
    const account = this.accounts.find(item => item.id === id);
    if (!account || account.hash) throw new Error('Tài khoản đã có mật khẩu');
    this.setHash(account, password);
    this.save();
    this.migrateLegacy(account);
    return this.public(account);
  }

  openWithoutPassword(id) {
    const account = this.accounts.find(item => item.id === id);
    if (!account || account.hash) throw new Error('Tài khoản đã có mật khẩu');
    account.passwordOptional = true;
    this.save();
    this.migrateLegacy(account);
    return this.public(account);
  }

  migrateLegacy(account) {
    if (!account.legacy) return;
    const target = this.dataDir(account.id);
    fs.mkdirSync(target, { recursive: true });
    for (const name of LEGACY_FILES) {
      const from = path.join(this.root, name);
      const to = path.join(target, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    }
    account.legacy = false;
    this.save();
  }

  changePassword(id, current, next) {
    if (!this.verify(id, current)) return false;
    const account = this.accounts.find(item => item.id === id);
    if (next) this.setHash(account, next);
    else {
      account.hash = null;
      account.salt = null;
      account.passwordOptional = true;
    }
    this.save();
    return true;
  }

  rename(id, name) {
    const account = this.accounts.find(item => item.id === id);
    if (!account) return;
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) return;
    account.name = clean;
    this.save();
  }
}

module.exports = AccountRegistry;
