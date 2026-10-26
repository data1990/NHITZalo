const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

class MessageStore {
  constructor(dbPath, legacyPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        cli_message_id TEXT,
        timestamp INTEGER NOT NULL,
        content TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (thread_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS messages_recent_idx ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS messages_cli_thread_idx ON messages(thread_id, cli_message_id);
      CREATE TABLE IF NOT EXISTS thread_identities (
        plain_id TEXT PRIMARY KEY,
        noised_id TEXT NOT NULL,
        is_group INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS thread_identities_noised_idx ON thread_identities(noised_id);
      CREATE TABLE IF NOT EXISTS store_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.insert = this.db.prepare(`INSERT INTO messages
      (thread_id, message_id, cli_message_id, timestamp, content, sender_name, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, message_id) DO UPDATE SET
        cli_message_id=excluded.cli_message_id, timestamp=excluded.timestamp,
        content=excluded.content, sender_name=excluded.sender_name, body=excluded.body`);
    this.existsById = this.db.prepare('SELECT 1 FROM messages WHERE thread_id = ? AND message_id = ? LIMIT 1');
    this.existsByCliId = this.db.prepare('SELECT 1 FROM messages WHERE thread_id = ? AND cli_message_id = ? LIMIT 1');
    this.identityByPlain = new Map();
    this.identityByNoised = new Map();
    for (const row of this.db.prepare('SELECT * FROM thread_identities').all()) this.cacheIdentity(row);
    this.ownPlainId = this.db.prepare("SELECT value FROM store_metadata WHERE key = 'own_plain_id'").get()?.value || '';
    this.migrateLegacy(legacyPath);
  }

  setOwnPlainId(value) {
    const plainId = String(value || '').trim();
    if (!/^\d{7,11}$/.test(plainId)) return false;
    this.db.prepare("INSERT INTO store_metadata (key, value) VALUES ('own_plain_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(plainId);
    this.ownPlainId = plainId;
    return true;
  }

  cacheIdentity(row) {
    const identity = { plainId: row.plain_id, noisedId: row.noised_id,
      isGroup: !!row.is_group, name: row.name || '', avatar: row.avatar || '' };
    this.identityByPlain.set(identity.plainId, identity);
    if (!this.identityByNoised.has(identity.noisedId)) this.identityByNoised.set(identity.noisedId, []);
    const aliases = this.identityByNoised.get(identity.noisedId);
    const index = aliases.findIndex(item => item.plainId === identity.plainId);
    if (index >= 0) aliases[index] = identity;
    else aliases.push(identity);
  }

  saveThreadIdentities(identities) {
    const save = this.db.prepare(`INSERT INTO thread_identities
      (plain_id, noised_id, is_group, name, avatar) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(plain_id) DO UPDATE SET noised_id=excluded.noised_id,
        is_group=excluded.is_group,
        name=CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END,
        avatar=CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE avatar END`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of identities) {
        if (!/^\d{7,11}$/.test(String(item.plainId)) || !/^\d{12,25}$/.test(String(item.noisedId))) continue;
        const name = String(item.name || '').trim();
        save.run(String(item.plainId), String(item.noisedId), item.isGroup ? 1 : 0,
          ['Bạn bè Zalo', 'Nhóm Zalo'].includes(name) ? '' : name, String(item.avatar || ''));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const lookup = this.db.prepare('SELECT * FROM thread_identities WHERE plain_id = ?');
    for (const item of identities) {
      const row = lookup.get(String(item.plainId));
      if (row) this.cacheIdentity(row);
    }
  }

  getUnresolvedBackupThreads() {
    const first = this.db.prepare('SELECT body FROM messages WHERE thread_id = ? LIMIT 1');
    return this.db.prepare('SELECT DISTINCT thread_id FROM messages WHERE length(thread_id) BETWEEN 7 AND 11').all()
      .filter(row => /^\d{7,11}$/.test(row.thread_id) && !this.identityByPlain.has(row.thread_id))
      .map(row => ({ plainId: row.thread_id, isGroup: !!JSON.parse(first.get(row.thread_id).body).isGroup }));
  }

  getPendingThreadProfiles() {
    return [...this.identityByPlain.values()].filter(item => !item.name);
  }

  hydrate(message) {
    if (this.ownPlainId && String(message.senderId || '') === this.ownPlainId) {
      message.isSelf = true;
      message.senderName = 'Bạn (Tôi)';
    }
    if (message.isGroup && !message.isSelf) {
      const senderId = String(message.senderId || '');
      const sender = this.identityByPlain.get(senderId)
        || this.identityByNoised.get(senderId)?.find(item => !item.isGroup);
      if (sender && !sender.isGroup) {
        if (sender.name && (!message.senderName || message.senderName === 'Thành viên nhóm'
          || message.senderName === message.threadName)) message.senderName = sender.name;
        if (sender.avatar && !message.avatar) message.avatar = sender.avatar;
      }
    }
    const threadId = String(message.threadId || '');
    const identity = this.identityByPlain.get(threadId) || this.identityByNoised.get(threadId)?.[0];
    if (!identity || identity.isGroup !== !!message.isGroup) return message;
    message.threadId = identity.noisedId;
    if (identity.name) {
      message.threadName = identity.name;
      if (!message.isGroup && !message.isSelf) message.senderName = identity.name;
    }
    if (identity.avatar) message.threadAvatar = identity.avatar;
    return message;
  }

  migrateLegacy(legacyPath) {
    if (!legacyPath || !fs.existsSync(legacyPath)) return;
    if (this.db.prepare('SELECT COUNT(*) AS count FROM messages').get().count > 0) return;
    const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Lịch sử JSON cũ không hợp lệ');
    const backupPath = `${legacyPath}.bak`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(legacyPath, backupPath);
    this.putMany(parsed.filter(m => m && !m.isConversation && !(m.id && String(m.id).startsWith('conv_'))));
  }

  put(message) {
    if (!message || !message.id || !message.threadId) return;
    this.insert.run(
      String(message.threadId), String(message.id), message.cliMsgId == null ? null : String(message.cliMsgId),
      Math.trunc(Number(message.timestamp) || 0), String(message.content || ''), String(message.senderName || ''),
      JSON.stringify(message)
    );
  }

  putMany(messages) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const message of messages) this.put(message);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getRecent(limit = 5000, offset = 0) {
    return this.db.prepare('SELECT body FROM messages ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?')
      .all(Math.max(1, Math.min(5000, Number(limit) || 5000)), Math.max(0, Number(offset) || 0))
      .map(row => this.hydrate(JSON.parse(row.body)));
  }

  getLatestPerThread() {
    const latest = this.db.prepare('SELECT body FROM messages WHERE thread_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1');
    return this.db.prepare('SELECT DISTINCT thread_id FROM messages').all()
      .map(row => this.hydrate(JSON.parse(latest.get(row.thread_id).body)));
  }

  getThread(threadId, limit = 50, offset = 0) {
    const canonical = this.identityByPlain.get(String(threadId))?.noisedId || String(threadId);
    const ids = [canonical, ...(this.identityByNoised.get(canonical) || []).map(item => item.plainId)];
    const placeholders = ids.map(() => '?').join(',');
    return this.db.prepare(`SELECT body FROM messages WHERE thread_id IN (${placeholders}) ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...ids, Math.max(1, Math.min(500, Number(limit) || 50)), Math.max(0, Number(offset) || 0))
      .map(row => this.hydrate(JSON.parse(row.body)));
  }

  hasMessage(threadId, messageId, cliMessageId, isGroup = false) {
    const raw = String(threadId || '');
    const withoutPrefix = raw.replace(/^g_?/, '');
    const canonical = this.identityByPlain.get(withoutPrefix)?.noisedId || withoutPrefix;
    const ids = new Set([raw, withoutPrefix, canonical]);
    if (isGroup) ids.add(`g_${canonical}`);
    for (const alias of this.identityByNoised.get(canonical) || []) {
      ids.add(alias.plainId);
      if (isGroup) ids.add(`g_${alias.plainId}`);
    }
    for (const id of ids) {
      if (!id) continue;
      if (messageId && this.existsById.get(id, String(messageId))) return true;
      if (cliMessageId && this.existsByCliId.get(id, String(cliMessageId))) return true;
    }
    return false;
  }

  enrichPhotoCaption(threadId, messageId, cliMessageId, isGroup, caption) {
    const text = String(caption || '').trim();
    if (!text) return null;
    const raw = String(threadId || '');
    const withoutPrefix = raw.replace(/^g_?/, '');
    const canonical = this.identityByPlain.get(withoutPrefix)?.noisedId || withoutPrefix;
    const ids = new Set([raw, withoutPrefix, canonical]);
    if (isGroup) ids.add(`g_${canonical}`);
    for (const alias of this.identityByNoised.get(canonical) || []) {
      ids.add(alias.plainId);
      if (isGroup) ids.add(`g_${alias.plainId}`);
    }
    const byId = this.db.prepare('SELECT body FROM messages WHERE thread_id = ? AND message_id = ?');
    const byCli = this.db.prepare('SELECT body FROM messages WHERE thread_id = ? AND cli_message_id = ? LIMIT 1');
    for (const id of ids) {
      if (!id) continue;
      const row = (messageId && byId.get(id, String(messageId))) ||
        (cliMessageId && byCli.get(id, String(cliMessageId)));
      if (!row) continue;
      const stored = JSON.parse(row.body);
      if (!stored.isPhoto || stored.isUndo || stored.isRevoked || stored.photoCaption) return null;
      stored.photoCaption = text;
      this.put(stored);
      return this.hydrate({ ...stored });
    }
    return null;
  }

  search(query, limit = 50, offset = 0) {
    const term = String(query || '').trim();
    if (!term) return [];
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare(`SELECT body FROM messages
      WHERE content LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\'
      ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(pattern, pattern, Math.max(1, Math.min(200, Number(limit) || 50)), Math.max(0, Number(offset) || 0))
      .map(row => this.hydrate(JSON.parse(row.body)));
  }

  clear() {
    this.db.exec('DELETE FROM messages');
    this.db.exec('DELETE FROM thread_identities');
    this.identityByPlain.clear();
    this.identityByNoised.clear();
  }

  getStats() {
    const row = this.db.prepare('SELECT COUNT(*) AS totalMessages, COUNT(DISTINCT thread_id) AS totalConversations FROM messages').get();
    return { totalMessages: row.totalMessages, totalConversations: row.totalConversations };
  }
}

module.exports = MessageStore;
