const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const MessageStore = require('../src/main/messageStore');
const { importDecryptedBackup, decryptBackupKey, validateBackupUrl, downloadBackup } = require('../src/main/phoneBackupImport');

test('Zalo native decoder receives a trailing slash on its output directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-decoder-path-'));
  const zaloDirectory = path.join(root, 'zalo');
  const bindingDirectory = path.join(zaloDirectory, 'resources', 'app.asar.unpacked',
    'native', 'nativelibs', 'db-cross-v4', 'dist');
  fs.mkdirSync(bindingDirectory, { recursive: true });
  fs.writeFileSync(path.join(bindingDirectory, 'binding.js'),
    "const fs = require('node:fs'); exports.decompressAndDecryptDb_V2 = (_input, output) => { fs.writeFileSync(output + '123.db', 'decoded'); return { result: 0 }; };\n");
  const outputPath = path.join(root, 'decrypted');
  const child = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'main', 'zaloBackupDecoderChild.js')], {
    input: JSON.stringify({ inputPath: path.join(root, 'ZaloDB_2'), outputPath,
      key: 'ABCD', zaloDirectory, conversationCount: 1 }), encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stdout || child.stderr);
  assert.equal(fs.existsSync(path.join(outputPath, '123.db')), true);
  assert.equal(fs.existsSync(path.join(root, 'decrypted123.db')), false);
});

function writeConversation(filePath, messages) {
  const db = new DatabaseSync(filePath);
  db.exec('CREATE TABLE ChatContent (GlbMsgId TEXT, CliMsgId TEXT, TimeStamp INTEGER, SenderId TEXT, MsgType INTEGER, MsgContent TEXT, MsgStatus INTEGER, BinNet BLOB)');
  const insert = db.prepare('INSERT INTO ChatContent VALUES (?, ?, ?, ?, ?, ?, ?, NULL)');
  db.exec('BEGIN IMMEDIATE');
  for (const msg of messages) insert.run(...msg);
  db.exec('COMMIT');
  db.close();
}

test('decrypted phone backup imports full text from personal and group conversations without duplicates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-test-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  writeConversation(path.join(backup, '123456.db'), [
    ['m1', 'c1', 1000, '123456', 0, 'Nội dung đầy đủ từ điện thoại', 1],
    ['m2', 'c2', 1001, 'self', 0, 'Tin do mình gửi', 1],
    ['m3', 'c3', 1002, '123456', 0, 'Bản nháp', 0]
  ]);
  writeConversation(path.join(backup, 'group_789.db'), [
    ['m4', 'c4', 2000, 'member', 0, 'Tin nhắn nhóm', 1]
  ]);
  const store = new MessageStore(path.join(root, 'messages.sqlite'));

  const first = await importDecryptedBackup({ folder: backup, store, accountId: 'self' });
  const second = await importDecryptedBackup({ folder: backup, store, accountId: 'self' });

  assert.equal(first.imported, 3);
  assert.equal(first.added, 3);
  assert.equal(second.added, 0);
  assert.equal(store.getStats().totalMessages, 3);
  assert.equal(store.getThread('123456', 10)[1].content, 'Nội dung đầy đủ từ điện thoại');
  assert.equal(store.getThread('123456', 10)[0].isSelf, true);
  assert.equal(store.getThread('789', 10)[0].isGroup, true);
});

test('phone backup imports playable voice attachment metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-voice-backup-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  const db = new DatabaseSync(path.join(backup, '123456789.db'));
  db.exec('CREATE TABLE ChatContent (GlbMsgId TEXT, CliMsgId TEXT, TimeStamp INTEGER, SenderId TEXT, MsgType INTEGER, MsgContent TEXT, MsgStatus INTEGER, BinNet BLOB)');
  db.prepare('INSERT INTO ChatContent VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'voice-1', 'cli-1', 1000, '555555555', 6, '0:08', 1, Buffer.from('native-attachment'));
  db.close();
  const store = new MessageStore(path.join(root, 'messages.sqlite'));
  let parsed = 0;
  await importDecryptedBackup({ folder: backup, store, accountId: '555555555',
    parseBinNetBatch: async items => {
      parsed = items.length;
      return items.map(item => ({ index: item.index,
        voiceUrl: 'https://f1.voice.talk.zdn.vn/a.amr',
        m4aUrl: 'https://f1.voice.talk.zdn.vn/a.m4a' }));
    } });
  const message = store.getThread('123456789')[0];
  assert.equal(parsed, 1);
  assert.equal(message.isSelf, true);
  assert.equal(message.voiceUrl, 'https://f1.voice.talk.zdn.vn/a.amr');
  assert.equal(message.m4aUrl, 'https://f1.voice.talk.zdn.vn/a.m4a');
});

test('Zalo native media parser extracts the voice and m4a attachments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-native-media-'));
  const bindingDirectory = path.join(root, 'resources', 'app.asar.unpacked',
    'native', 'nativelibs', 'db-cross-v4', 'dist');
  fs.mkdirSync(bindingDirectory, { recursive: true });
  fs.writeFileSync(path.join(bindingDirectory, 'binding.js'),
    "exports.parseBinNet = () => ({ result: 0, data: { attachs: [{ href: 'https://f1.voice.talk.zdn.vn/a.amr', params: JSON.stringify({ m4a: 'https://f1.voice.talk.zdn.vn/a.m4a' }) }] } });\n");
  const child = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'main', 'zaloBackupMediaChild.js')], {
    input: JSON.stringify({ zaloDirectory: root, items: [{ index: 3, binNet: Buffer.from('sample').toString('base64') }] }),
    encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout).results, [{ index: 3,
    voiceUrl: 'https://f1.voice.talk.zdn.vn/a.amr', m4aUrl: 'https://f1.voice.talk.zdn.vn/a.m4a' }]);
});

test('phone backup keeps file attachment metadata from BinNet', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-file-backup-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  const db = new DatabaseSync(path.join(backup, '123456789.db'));
  db.exec('CREATE TABLE ChatContent (GlbMsgId TEXT, CliMsgId TEXT, TimeStamp INTEGER, SenderId TEXT, MsgType INTEGER, MsgContent TEXT, MsgStatus INTEGER, BinNet BLOB)');
  db.prepare('INSERT INTO ChatContent VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'file-1', 'cli-1', 1000, '555555555', 22, 'report.pdf', 1, Buffer.from('native-attachment'));
  db.close();
  const store = new MessageStore(path.join(root, 'messages.sqlite'));
  let parsed = 0;
  await importDecryptedBackup({ folder: backup, store, accountId: '555555555',
    parseBinNetBatch: async items => {
      parsed = items.length;
      return [{ index: items[0].index, fileUrl: 'https://f1.zdn.vn/report.pdf',
        fileName: 'report.pdf', fileSize: 12345 }];
    } });
  const message = store.getThread('123456789')[0];
  assert.equal(parsed, 1);
  assert.equal(message.fileUrl, 'https://f1.zdn.vn/report.pdf');
  assert.equal(message.fileName, 'report.pdf');
  assert.equal(message.fileSize, 12345);
});

test('Zalo native media parser extracts file metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-native-file-'));
  const bindingDirectory = path.join(root, 'resources', 'app.asar.unpacked',
    'native', 'nativelibs', 'db-cross-v4', 'dist');
  fs.mkdirSync(bindingDirectory, { recursive: true });
  fs.writeFileSync(path.join(bindingDirectory, 'binding.js'),
    "exports.parseBinNet = () => ({ result: 0, data: { attachs: [{ href: 'https://f1.zdn.vn/report.pdf', title: 'report.pdf', params: JSON.stringify({ fileSize: 12345 }) }] } });\n");
  const child = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'main', 'zaloBackupMediaChild.js')], {
    input: JSON.stringify({ zaloDirectory: root, items: [{ index: 0, msgType: 22,
      binNet: Buffer.from('sample').toString('base64') }] }), encoding: 'utf8'
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout).results, [{ index: 0,
    fileUrl: 'https://f1.zdn.vn/report.pdf', fileName: 'report.pdf', fileSize: 12345 }]);
});

test('phone backup key uses the PKCS1 padding required by Zalo PC', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = crypto.randomBytes(32);
  const encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, secret);
  assert.equal(decryptBackupKey(encrypted.toString('base64'), privateKey), secret.toString('hex').toUpperCase());
});

test('phone backup downloads only from the Zalo transfer host', () => {
  assert.equal(validateBackupUrl('https://trans-bin.zaloapp.com/download/token').hostname, 'trans-bin.zaloapp.com');
  assert.throws(() => validateBackupUrl('http://trans-bin.zaloapp.com/download/token'));
  assert.throws(() => validateBackupUrl('https://trans-bin.zaloapp.com.evil.example/download/token'));
});

test('phone backup download verifies exact size and checksum before import', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-download-'));
  const outputPath = path.join(root, 'ZaloDB_2');
  const payload = Buffer.from('encrypted backup bytes');
  const request = async () => ({ ok: true, status: 200, body: Readable.from([payload]) });
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: payload.length, checksum: crypto.createHash('md5').update(payload).digest('hex'),
    outputPath, ctx: {}, request });
  assert.deepEqual(fs.readFileSync(outputPath), payload);
  fs.rmSync(outputPath);
  await assert.rejects(downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: payload.length, checksum: '0'.repeat(32), outputPath, ctx: {}, request }), /Mã kiểm tra/);
  assert.equal(fs.existsSync(outputPath), false);
});

test('backup file request does not send chat API Origin or form headers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-headers-'));
  const payload = Buffer.from('backup');
  let seen;
  const ctx = {
    userAgent: 'ZaloPC-test',
    cookie: { getCookieString: async () => 'session=test' }
  };
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: payload.length, outputPath: path.join(root, 'ZaloDB_2'), ctx,
    request: async (...args) => {
      seen = args;
      return { ok: true, status: 200, body: Readable.from([payload]) };
    } });
  assert.equal(seen[3], true);
  assert.equal(seen[2].headers['User-Agent'], undefined);
  assert.equal(seen[2].headers.Cookie, 'session=test');
  assert.equal(seen[2].headers.Origin, undefined);
  assert.equal(seen[2].headers['content-type'], undefined);
});

test('backup download retries a transient HTTP 400 before declaring failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-retry-'));
  const payload = Buffer.from('ready after transfer');
  let calls = 0;
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: payload.length, outputPath: path.join(root, 'ZaloDB_2'),
    ctx: {}, retryDelayMs: 0,
    request: async () => ++calls === 1
      ? { ok: false, status: 400, body: Readable.from([]) }
      : { ok: true, status: 200, body: Readable.from([payload]) } });
  assert.equal(calls, 2);
});

test('backup download keeps injected request compatibility without chat API headers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-fetch-'));
  let options;
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: 2, outputPath: path.join(root, 'ZaloDB_2'),
    request: async (_ctx, _url, givenOptions) => {
      options = givenOptions;
      return { ok: true, status: 200, body: Readable.from([Buffer.from('ok')]) };
    } });
  assert.equal(options.headers['User-Agent'], undefined);
  assert.equal(options.headers.Origin, undefined);
});

test('backup download sends the zpw_sek cookie Zalo PC installs on zaloapp.com', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-auth-cookie-'));
  let headers;
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: 2, outputPath: path.join(root, 'ZaloDB_2'),
    ctx: { cookie: { getCookieString: async () => '' } },
    sessionCookies: [
      { key: 'zpsid', value: 'auth-token', domain: 'zaloapp.com', path: '/', secure: true },
      { key: '__zi', value: 'device-token', domain: 'zaloapp.com', path: '/', secure: true },
      { key: 'zpw_sek', value: 'account-auth', domain: 'chat.zalo.me', path: '/', secure: true }
    ],
    request: async (_ctx, _url, options) => {
      headers = options.headers;
      return { ok: true, status: 200, body: Readable.from([Buffer.from('ok')]) };
    } });
  assert.equal(headers.Cookie, 'zpw_sek=account-auth;');
});

test('backup download uses Electron net streaming instead of the chat API fetch', async () => {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-electron-net-'));
  const payload = Buffer.from('streamed Zalo backup');
  let requestOptions;
  const sentHeaders = {};
  const netRequest = options => {
    requestOptions = options;
    const client = new EventEmitter();
    client.setHeader = (name, value) => { sentHeaders[name.toLowerCase()] = value; };
    client.end = () => {
      const response = Readable.from([payload]);
      response.statusCode = 200;
      process.nextTick(() => client.emit('response', response));
    };
    return client;
  };
  await downloadBackup({ url: 'https://trans-bin.zaloapp.com/download/token',
    fileSize: payload.length, outputPath: path.join(root, 'ZaloDB_2'),
    ctx: { userAgent: 'ZaloPC-test', options: { polyfill: () => { throw new Error('Chat fetch was called'); } } },
    sessionCookies: [{ key: 'zpsid', value: 'auth-token', domain: 'zaloapp.com', path: '/', secure: true }],
    netRequest });
  assert.equal(requestOptions.url, 'https://trans-bin.zaloapp.com/download/token');
  assert.equal(requestOptions.method, 'GET');
  assert.match(sentHeaders.cookie, /zpsid=auth-token/);
  assert.equal(sentHeaders['user-agent'], undefined);
  assert.deepEqual(fs.readFileSync(path.join(root, 'ZaloDB_2')), payload);
});

test('backup diagnostics record HTTP status without exposing cookie values or transfer URL', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-diagnostic-'));
  const diagnosticPath = path.join(root, 'sync-download-diagnostics.log');
  await assert.rejects(downloadBackup({
    url: 'https://trans-bin.zaloapp.com/download/private-token',
    outputPath: path.join(root, 'ZaloDB_2'),
    sessionCookies: [{ key: 'zpsid', value: 'private-cookie', domain: 'zaloapp.com', path: '/', secure: true }],
    diagnosticPath, retryDelayMs: 0,
    request: async () => ({ ok: false, status: 400, body: Readable.from([]) })
  }), /HTTP 400/);
  const log = fs.readFileSync(diagnosticPath, 'utf8');
  assert.match(log, /"status":400/);
  assert.match(log, /"authCookieCount":1/);
  assert.doesNotMatch(log, /private-cookie|private-token/);
});

test('large backup import yields to the event loop while saving batches', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-backup-yield-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  writeConversation(path.join(backup, '123456.db'), Array.from({ length: 1100 }, (_, i) =>
    [`m${i}`, `c${i}`, i + 1, '123456', 0, `Tin ${i}`, 1]));
  const store = new MessageStore(path.join(root, 'messages.sqlite'));
  let eventLoopRan = false;
  setImmediate(() => { eventLoopRan = true; });
  const result = await importDecryptedBackup({ folder: backup, store, accountId: 'self' });
  assert.equal(result.imported, 1100);
  assert.equal(eventLoopRan, true);
});
