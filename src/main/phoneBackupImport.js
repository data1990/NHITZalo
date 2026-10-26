const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { setImmediate: yieldToEventLoop } = require('node:timers/promises');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { Cookie, CookieJar } = require('tough-cookie');
const { getPhotoCaption } = require('../shared/photoCaption');

const EXCLUDED_TYPES = [20, 21, 25, 26, 29, 32, 34, 35, 45, 51, 52];
const TYPE_NAMES = new Map([
  [0, 'webchat'], [2, 'chat.doodle'], [3, 'chat.photo'], [4, 'chat.photo'],
  [6, 'chat.voice'], [10, 'chat.sticker'], [12, 'chat.recommended'],
  [18, 'chat.location.new'], [19, 'chat.video.msg'], [22, 'share.file'],
  [23, 'chat.gif'], [24, 'chat.webcontent'], [31, 'chat.photo'],
  [33, 'chat.delete'], [36, 'chat.undo'], [53, 'chat.webcontent.v2']
]);

function validateBackupUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'trans-bin.zaloapp.com') {
    throw new Error('Địa chỉ bản sao lưu không thuộc máy chủ truyền dữ liệu Zalo');
  }
  return url;
}

function decryptBackupKey(encryptedKey, privateKey) {
  if (!encryptedKey || !privateKey) throw new Error('Thiếu khóa giải mã bản sao lưu');
  return crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encryptedKey, 'base64')).toString('hex').toUpperCase();
}

function getSavedAuthCookieHeader(sessionCookies) {
  const cookies = Array.isArray(sessionCookies) ? sessionCookies : sessionCookies?.cookies;
  if (!Array.isArray(cookies)) return '';
  const jar = new CookieJar();
  // Zalo PC's setAppCookie copies its login zpw_sek to zaloapp.com before
  // downloading the phone backup. The QR library only saves it for chat.zalo.me.
  const appAuth = cookies.find(entry => (entry.key || entry.name) === 'zpw_sek' && entry.value);
  if (appAuth) {
    try {
      const cookie = Cookie.fromJSON({ ...appAuth, key: 'zpw_sek', domain: 'zaloapp.com' });
      jar.setCookieSync(cookie, 'https://wpa.zaloapp.com');
      const header = jar.getCookieStringSync('https://wpa.zaloapp.com');
      if (header) return `${header};`;
    } catch (_) { /* Fall back to domain-scoped session cookies below. */ }
  }
  for (const entry of cookies) {
    try {
      const cookie = Cookie.fromJSON({ ...entry, key: entry.key || entry.name });
      if (cookie) jar.setCookieSync(cookie, 'https://wpa.zaloapp.com');
    } catch (_) {
      // Login sessions also include unrelated id.zalo.me and chat.zalo.me cookies.
    }
  }
  return jar.getCookieStringSync('https://wpa.zaloapp.com');
}

function requestBackupWithElectronNet(url, headers, netRequest, netSession) {
  const electron = netRequest ? null : require('electron');
  const createRequest = netRequest || electron.net.request;
  const session = netSession || electron?.session?.defaultSession;
  return new Promise((resolve, reject) => {
    const request = createRequest({ url, method: 'GET', ...(session ? { session } : {}) });
    let settled = false;
    let responseStream = null;
    request.on('redirect', () => request.followRedirect());
    request.on('error', error => {
      if (responseStream) responseStream.destroy(error);
      else if (!settled) { settled = true; reject(error); }
    });
    request.on('response', response => {
      responseStream = response;
      settled = true;
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode, body: response });
    });
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    request.end();
  });
}

async function downloadBackup({ url, fileSize, checksum, outputPath, ctx, sessionCookies,
  request, netRequest, netSession, diagnosticPath, retryDelayMs = 5000 }) {
  const validated = validateBackupUrl(url);
  const writeDiagnostic = details => {
    if (!diagnosticPath) return;
    try {
      fs.appendFileSync(diagnosticPath, JSON.stringify({ at: new Date().toISOString(),
        host: validated.hostname, ...details }) + '\n', 'utf8');
    } catch (_) { /* Diagnostics must not prevent the download. */ }
  };
  const headers = {};
  const cookie = getSavedAuthCookieHeader(sessionCookies)
    || await ctx?.cookie?.getCookieString?.('https://wpa.zaloapp.com');
  if (cookie) headers.Cookie = cookie;
  const authCookieCount = cookie ? cookie.split(';').filter(Boolean).length : 0;
  const transport = typeof request === 'function' ? 'injected' : 'electron.net';
  console.info('Phone backup download:', { host: validated.hostname, authCookieCount, transport });
  writeDiagnostic({ phase: 'request', authCookieCount, transport });
  // Zalo PC downloads phone backups with Electron net.request, not the chat API fetch.
  // Electron streams the response instead of buffering the whole backup in memory.
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = typeof request === 'function'
      ? await request(ctx, validated.toString(), { method: 'GET', headers }, true)
      : await requestBackupWithElectronNet(validated.toString(), headers, netRequest, netSession);
    writeDiagnostic({ phase: 'response', attempt: attempt + 1, status: response.status,
      authCookieCount, transport });
    if (response.ok || ![400, 408, 429].includes(response.status) && response.status < 500) break;
    if (attempt === 2) break;
    if (typeof response.body?.cancel === 'function') await response.body.cancel();
    else response.body?.destroy?.();
    if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  console.info('Phone backup response:', { status: response.status });
  if (!response.ok) throw new Error(`Không tải được bản sao lưu từ Zalo (HTTP ${response.status})`);
  const readable = typeof response.body?.getReader === 'function'
    ? Readable.fromWeb(response.body) : response.body;
  if (!readable) throw new Error('Máy chủ Zalo không trả dữ liệu bản sao lưu');
  const output = fs.createWriteStream(outputPath, { flags: 'wx' });
  const hash = crypto.createHash('md5');
  let bytes = 0;
  try {
    for await (const chunk of readable) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024 * 1024 || (fileSize > 0 && bytes > fileSize)) {
        throw new Error('Kích thước bản sao lưu vượt quá thông tin điện thoại cung cấp');
      }
      hash.update(chunk);
      if (!output.write(chunk)) await once(output, 'drain');
    }
    output.end();
    await once(output, 'finish');
    if (fileSize > 0 && bytes !== fileSize) throw new Error('Bản sao lưu tải về chưa đủ dung lượng');
    if (checksum && /^[a-f\d]{32}$/i.test(checksum) && hash.digest('hex').toLowerCase() !== checksum.toLowerCase()) {
      throw new Error('Mã kiểm tra bản sao lưu không khớp');
    }
    return bytes;
  } catch (error) {
    output.destroy();
    try { fs.rmSync(outputPath, { force: true }); } catch (_) {}
    throw error;
  }
}

function externalChildPath(filename) {
  return path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), filename);
}

function decodeBackupWithZalo({ inputPath, outputPath, key, zaloDirectory, conversationCount = 0, onProgress = () => {} }) {
  const executable = path.join(zaloDirectory, 'Zalo.exe');
  const binding = path.join(zaloDirectory, 'resources', 'app.asar.unpacked',
    'native', 'nativelibs', 'db-cross-v4', 'dist', 'binding.js');
  if (!fs.existsSync(executable) || !fs.existsSync(binding)) {
    throw new Error('Không tìm thấy bộ giải mã của Zalo PC 26.10.20');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [externalChildPath('zaloBackupDecoderChild.js')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    let final = null;
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.progress != null) onProgress(event);
          if (event.success != null) final = event;
        } catch (_) {}
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 && final?.success) resolve(final);
      else reject(new Error(final?.error || `Bộ giải mã Zalo PC dừng với mã ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify({ inputPath, outputPath, key, zaloDirectory, conversationCount }));
  });
}

function parseBackupMediaWithZalo({ items, zaloDirectory }) {
  if (!items.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(zaloDirectory, 'Zalo.exe'),
      [externalChildPath('zaloBackupMediaChild.js')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Không đọc được dữ liệu thoại Zalo: ${stderr || code}`));
      try { resolve(JSON.parse(stdout).results || []); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ items, zaloDirectory }));
  });
}

async function importDecryptedBackup({ folder, store, accountId, onProgress = () => {},
  resolveThread = () => ({}), parseBinNetBatch }) {
  const entries = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(?:group_)?\d+\.db$/i.test(entry.name));
  if (entries.length === 0) throw new Error('Bản sao lưu đã giải mã không chứa cơ sở dữ liệu hội thoại');

  store.setOwnPlainId(accountId);

  const before = store.getStats().totalMessages;
  const findExisting = store.db.prepare('SELECT content FROM messages WHERE thread_id = ? AND message_id = ?');
  const timeFormatter = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
  let imported = 0;
  let skipped = 0;
  let conversations = 0;
  const mediaCandidates = [];
  for (const entry of entries) {
    const isGroup = entry.name.startsWith('group_');
    const threadId = entry.name.replace(/^group_/, '').replace(/\.db$/i, '');
    const thread = resolveThread(threadId, isGroup) || {};
    const db = new DatabaseSync(path.join(folder, entry.name), { readOnly: true });
    try {
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ChatContent'").get();
      if (!table) throw new Error(`Thiếu bảng ChatContent trong ${entry.name}`);
      const rows = db.prepare(`SELECT CAST(GlbMsgId AS TEXT) AS GlbMsgId,
          CAST(CliMsgId AS TEXT) AS CliMsgId, TimeStamp,
          CAST(SenderId AS TEXT) AS SenderId, MsgType, MsgContent, BinNet
        FROM ChatContent WHERE MsgStatus > 0 AND CliMsgId IS NOT NULL
          AND MsgType NOT IN (${EXCLUDED_TYPES.join(',')}) ORDER BY TimeStamp ASC`);
      const batch = [];
      for (const row of rows.iterate()) {
        const msgType = Number(row.MsgType);
        const id = String(row.GlbMsgId && row.GlbMsgId !== '0' ? row.GlbMsgId : row.CliMsgId);
        if (!id) { skipped++; continue; }
        const isSelf = row.SenderId === '0' || row.SenderId === String(accountId);
        const rawContent = Buffer.isBuffer(row.MsgContent)
          ? row.MsgContent.toString('utf8') : String(row.MsgContent ?? '');
        if (ArrayBuffer.isView(row.BinNet) && ([3, 4, 6, 19, 22, 31].includes(msgType) ||
          (msgType === 12 && /^\d{1,2}:\d{1,2}$/.test(rawContent)))) {
          mediaCandidates.push({ index: mediaCandidates.length, threadId, id, msgType,
            binNet: Buffer.from(row.BinNet).toString('base64') });
        }
        const isUndo = msgType === 36 || msgType === 33;
        const fallback = isUndo ? 'Tin nhắn đã được thu hồi'
          : ({ 2: '[Hình vẽ]', 3: '[Hình ảnh]', 4: '[Hình ảnh]', 6: '[Tin nhắn thoại]',
            10: '[Nhãn dán Sticker]', 19: '[Video]', 22: '[Tài liệu]', 23: '[Ảnh động]',
            31: '[Hình ảnh]' })[msgType] || '[Tin nhắn]';
        if (!rawContent && findExisting.get(threadId, id)) { skipped++; continue; }
        const timestamp = Math.trunc(Number(row.TimeStamp) || 0);
        batch.push({
          id, cliMsgId: String(row.CliMsgId), threadId,
          threadName: thread.name || '', threadAvatar: thread.avatar || '',
          senderId: row.SenderId || '', senderName: isSelf ? 'Bạn (Tôi)' : (thread.name || ''),
          msgType: TYPE_NAMES.get(msgType) || String(msgType),
          content: isUndo ? fallback : (rawContent || fallback),
          isGroup, isSelf, isUndo, isRevoked: isUndo, isRecalled: isUndo,
          isPhoto: [3, 4, 31].includes(msgType), isSticker: msgType === 10,
          photoCaption: [3, 4, 31].includes(msgType)
            ? getPhotoCaption({ isPhoto: true, content: rawContent }) : '',
          isVideo: msgType === 19, isFile: msgType === 22,
          timestamp,
          time: timestamp ? timeFormatter.format(timestamp) : ''
        });
        imported++;
        if (batch.length >= 500) {
          store.putMany(batch);
          batch.length = 0;
          await yieldToEventLoop();
        }
      }
      if (batch.length) store.putMany(batch);
    } finally {
      db.close();
    }
    conversations++;
    onProgress({ conversations, imported, skipped });
    await yieldToEventLoop();
  }
  let voiceAttachments = 0;
  let mediaAttachments = 0;
  if (mediaCandidates.length && typeof parseBinNetBatch === 'function') {
    try {
      const parsed = await parseBinNetBatch(mediaCandidates);
      const findBody = store.db.prepare('SELECT body FROM messages WHERE thread_id = ? AND message_id = ?');
      for (const media of parsed) {
        const candidate = mediaCandidates[media.index];
        if (!candidate || !['voiceUrl', 'm4aUrl', 'fileUrl', 'photoUrl', 'videoUrl']
          .some(field => media[field])) continue;
        const row = findBody.get(candidate.threadId, candidate.id);
        if (!row) continue;
        const metadata = Object.fromEntries(Object.entries(media)
          .filter(([key, value]) => key !== 'index' && value !== '' && value !== 0));
        const saved = JSON.parse(row.body);
        store.put({ ...saved, ...metadata,
          photoCaption: saved.photoCaption || metadata.photoCaption || '' });
        if (media.voiceUrl || media.m4aUrl) voiceAttachments++;
        mediaAttachments++;
      }
    } catch (error) {
      console.warn('Không thể đọc thông tin tệp đính kèm trong bản sao lưu:', error.message);
    }
  }
  return { imported, added: store.getStats().totalMessages - before, skipped,
    conversations: entries.length, voiceAttachments, mediaAttachments };
}

module.exports = { importDecryptedBackup, decryptBackupKey, validateBackupUrl, downloadBackup,
  decodeBackupWithZalo, parseBackupMediaWithZalo, getSavedAuthCookieHeader };
