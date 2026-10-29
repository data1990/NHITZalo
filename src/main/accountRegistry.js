const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const MessageStore = require('./messageStore');

const LEGACY_FILES = [
  'zalo_session.json', 'zalo_messages.json', 'zalo_messages.sqlite',
  'zalo_messages.sqlite-wal', 'zalo_messages.sqlite-shm',
  'zalo_groups.json', 'zalo_friends.json', 'zalo_pinned.json',
  'zalo_muted.json', 'zalo_read.json', 'sync-download-diagnostics.log',
  'bubble_pos.json'
];
const LEGACY_ACCOUNT_FILES = LEGACY_FILES.filter(name => name.startsWith('zalo_'));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

function mergeJsonFile(targetDir, sourceDir, name) {
  const sourcePath = path.join(sourceDir, name);
  if (!fs.existsSync(sourcePath)) return;
  const targetPath = path.join(targetDir, name);
  if (!fs.existsSync(targetPath)) { fs.copyFileSync(sourcePath, targetPath); return; }
  const target = readJson(targetPath);
  const source = readJson(sourcePath);
  if (target === null || source === null) return;
  let merged;
  if (name === 'zalo_friends.json' && Array.isArray(target) && Array.isArray(source)) {
    const seen = new Set(target.map(item => String(item?.userId || item?.id || '')));
    merged = [...target];
    for (const item of source) {
      const key = String(item?.userId || item?.id || '');
      if (key && !seen.has(key)) { merged.push(item); seen.add(key); }
    }
  } else if (name === 'zalo_pinned.json' && Array.isArray(target) && Array.isArray(source)) {
    merged = [...new Set([...target, ...source])];
  } else if (name === 'zalo_read.json' && !Array.isArray(target) && !Array.isArray(source)) {
    merged = { ...source, ...target };
    for (const key of Object.keys(source)) {
      if (typeof source[key] === 'number' && typeof target[key] === 'number') merged[key] = Math.max(source[key], target[key]);
    }
  } else if (name === 'file-downloads.json' && !Array.isArray(target) && !Array.isArray(source)) {
    merged = { ...source, ...target, files: { ...(source.files || {}), ...(target.files || {}) } };
  } else if (typeof target === 'object' && typeof source === 'object' && !Array.isArray(target) && !Array.isArray(source)) {
    merged = { ...source, ...target };
  } else return;
  const backupPath = `${targetPath}.pre-merge`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(targetPath, backupPath);
  writeJson(targetPath, merged);
}

function mergeMessageDatabases(targetDir, sourceDir) {
  const sourcePath = path.join(sourceDir, 'zalo_messages.sqlite');
  const sourceLegacy = path.join(sourceDir, 'zalo_messages.json');
  if (!fs.existsSync(sourcePath) && !fs.existsSync(sourceLegacy)) return;
  const targetPath = path.join(targetDir, 'zalo_messages.sqlite');
  const sourceStore = new MessageStore(sourcePath, sourceLegacy);
  sourceStore.db.close();
  const targetStore = new MessageStore(targetPath, path.join(targetDir, 'zalo_messages.json'));
  targetStore.db.close();
  const db = new DatabaseSync(targetPath);
  let attached = false;
  let transaction = false;
  try {
    db.prepare('ATTACH DATABASE ? AS duplicate').run(sourcePath);
    attached = true;
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    db.exec(`INSERT OR IGNORE INTO main.messages
      (thread_id,message_id,cli_message_id,timestamp,content,sender_name,body)
      SELECT thread_id,message_id,cli_message_id,timestamp,content,sender_name,body FROM duplicate.messages`);
    db.exec(`INSERT OR IGNORE INTO main.thread_identities
      (plain_id,noised_id,is_group,name,avatar)
      SELECT plain_id,noised_id,is_group,name,avatar FROM duplicate.thread_identities`);
    db.exec('INSERT OR IGNORE INTO main.store_metadata (key,value) SELECT key,value FROM duplicate.store_metadata');
    db.exec('COMMIT');
    transaction = false;
    db.exec('DETACH DATABASE duplicate');
    attached = false;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (error) {
    if (transaction) { try { db.exec('ROLLBACK'); } catch (_) {} }
    throw error;
  } finally {
    if (attached) { try { db.exec('DETACH DATABASE duplicate'); } catch (_) {} }
    db.close();
  }
}

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
      hosted: !!account.hostedOrigin,
      needsPassword: !account.hash && !account.passwordOptional,
      requiresPassword: !!account.hash,
      originLegacy: !!account.originLegacy,
      hasSession: fs.existsSync(path.join(this.dataDir(account.id), 'zalo_session.json')) ||
        (account.legacy && fs.existsSync(path.join(this.root, 'zalo_session.json'))) };
  }

  list() { return this.accounts.map(account => this.public(account)); }

  readZaloName(sessionPath, safeStorage) {
    try {
      const session = this.readSession(sessionPath, safeStorage);
      const info = session?.userInfo;
      const name = String(info?.name || info?.displayName || info?.zaloName || '').trim();
      return name === 'Người dùng Zalo' ? '' : name.slice(0, 80);
    } catch (_) {
      return '';
    }
  }

  readSession(sessionPath, safeStorage) {
    const saved = readJson(sessionPath);
    if (saved?.version === 2 && saved.ciphertext) {
      if (!safeStorage?.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(Buffer.from(saved.ciphertext, 'base64')));
    }
    return saved;
  }

  profileIdentity(account, safeStorage) {
    const dir = this.dataDir(account.id);
    const localSession = path.join(dir, 'zalo_session.json');
    const sessionPath = account.legacy && !fs.existsSync(localSession)
      ? path.join(this.root, 'zalo_session.json') : localSession;
    if (fs.existsSync(sessionPath)) {
      const saved = readJson(sessionPath);
      if (!saved || (saved.version === 2 && !safeStorage?.isEncryptionAvailable())) return '';
    }
    let sessionId = '';
    try { sessionId = String(this.readSession(sessionPath, safeStorage)?.userInfo?.userId || ''); }
    catch (_) { return ''; }
    let storeId = '';
    const dbPath = path.join(dir, 'zalo_messages.sqlite');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try { storeId = String(db.prepare("SELECT value FROM store_metadata WHERE key='own_plain_id'").get()?.value || ''); }
        finally { db.close(); }
      } catch (_) { return ''; }
    }
    if (sessionId && storeId && sessionId !== storeId) return '';
    const identity = sessionId || storeId;
    return /^\d{7,40}$/.test(identity) ? identity : '';
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
    const base = path.resolve(this.root, 'accounts');
    const directory = path.resolve(base, id);
    if (!directory.startsWith(base + path.sep)) throw new Error('Đường dẫn tài khoản không hợp lệ');
    return directory;
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

  findOrCreateHosted(origin, remoteId, label, remoteUserId = '', safeStorage) {
    const cleanName = String(label || '').trim().slice(0, 80) || 'Tài khoản Zalo trên web';
    const key = String(remoteId);
    let account = this.accounts.find(item => item.hostedOrigin === origin && item.hostedAccountId === key);
    if (!account && /^\d{7,40}$/.test(String(remoteUserId))) {
      account = this.accounts.find(item => !item.hostedOrigin && !item.legacy &&
        this.profileIdentity(item, safeStorage) === String(remoteUserId));
      if (account) { account.hostedOrigin = origin; account.hostedAccountId = key; }
    }
    if (!account) {
      account = { id: crypto.randomUUID(), name: cleanName, hostedOrigin: origin,
        hostedAccountId: key, passwordOptional: true, createdAt: Date.now() };
      this.accounts.push(account);
      fs.mkdirSync(this.dataDir(account.id), { recursive: true });
    } else if (!account.zaloName) account.name = cleanName;
    this.save();
    return this.public(account);
  }

  consolidateSameZaloProfiles(safeStorage) {
    const groups = new Map();
    for (const account of this.accounts) {
      if (account.legacy) continue;
      const identity = this.profileIdentity(account, safeStorage);
      if (!identity) continue;
      if (!groups.has(identity)) groups.set(identity, []);
      groups.get(identity).push(account);
    }
    let merged = 0;
    for (const profiles of groups.values()) {
      if (profiles.length < 2) continue;
      const remoteKeys = new Set(profiles.filter(item => item.hostedOrigin)
        .map(item => `${item.hostedOrigin}|${item.hostedAccountId}`));
      if (remoteKeys.size > 1) continue;
      const protectedProfiles = profiles.filter(item => item.hash);
      if (protectedProfiles.length > 1) continue;
      const primary = protectedProfiles[0] || profiles.find(item => !item.hostedOrigin) || profiles[0];
      for (const duplicate of profiles) {
        if (duplicate === primary) continue;
        const primaryDir = this.dataDir(primary.id);
        const duplicateDir = this.dataDir(duplicate.id);
        try {
          mergeMessageDatabases(primaryDir, duplicateDir);
          for (const name of ['zalo_friends.json', 'zalo_groups.json', 'zalo_pinned.json',
            'zalo_muted.json', 'zalo_read.json', 'file-downloads.json']) {
            mergeJsonFile(primaryDir, duplicateDir, name);
          }
          const sessionPath = path.join(primaryDir, 'zalo_session.json');
          if (!fs.existsSync(sessionPath)) {
            const duplicateSession = path.join(duplicateDir, 'zalo_session.json');
            if (fs.existsSync(duplicateSession)) fs.copyFileSync(duplicateSession, sessionPath);
          }
          if (duplicate.hostedOrigin) {
            const bridgePath = path.join(duplicateDir, 'hosted_session_bridge.json');
            if (fs.existsSync(bridgePath)) {
              const destination = path.join(primaryDir, 'hosted_session_bridge.json');
              if (fs.existsSync(destination) && !fs.existsSync(`${destination}.pre-merge`)) {
                fs.copyFileSync(destination, `${destination}.pre-merge`);
              }
              fs.copyFileSync(bridgePath, destination);
            }
            primary.hostedOrigin = duplicate.hostedOrigin;
            primary.hostedAccountId = duplicate.hostedAccountId;
          }
          if (!primary.zaloName && duplicate.zaloName) primary.zaloName = duplicate.zaloName;
          this.accounts = this.accounts.filter(item => item.id !== duplicate.id);
          this.save();
          const archiveRoot = path.resolve(this.root, 'merged-accounts');
          fs.mkdirSync(archiveRoot, { recursive: true });
          const archivePath = path.resolve(archiveRoot, duplicate.id);
          if (!archivePath.startsWith(archiveRoot + path.sep)) throw new Error('Đường dẫn lưu trữ không hợp lệ');
          if (!fs.existsSync(archivePath)) {
            try { fs.renameSync(duplicateDir, archivePath); }
            catch (error) { console.warn('Không thể lưu trữ hồ sơ trùng sau khi gộp:', error.message); }
          }
          merged += 1;
        } catch (error) {
          console.warn('Không thể gộp hồ sơ Zalo trùng:', error.message);
        }
      }
    }
    return merged;
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

  remove(id, password = '') {
    const account = this.accounts.find(item => item.id === id);
    if (!account) throw new Error('Không tìm thấy tài khoản');
    if (account.hash && !this.verify(id, password)) throw new Error('Mật khẩu không đúng');
    if (account.legacy) this.migrateLegacy(account);
    const directory = this.dataDir(id);
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Thư mục tài khoản không hợp lệ');
      fs.rmSync(directory, { recursive: true, force: false });
    }
    if (account.originLegacy) {
      for (const name of LEGACY_FILES) {
        const legacyPath = path.join(this.root, name);
        if (fs.existsSync(legacyPath)) fs.rmSync(legacyPath);
      }
    }
    this.accounts = this.accounts.filter(item => item.id !== id);
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
