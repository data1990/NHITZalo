const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

function createManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-caption-'));
  const load = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../../scripts/patch-zalo.js') return {};
    if (request === 'zalo-api-final') return { Zalo: class {} };
    if (request === 'electron') return { app: { getPath: () => dir } };
    return load.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/zaloManager')];
    return new (require('../src/main/zaloManager'))();
  } finally { Module._load = load; }
}

test('photo message keeps Zalo title as its visible caption', () => {
  const manager = createManager();
  const message = manager.formatMessage({ type: 0, data: {
    msgId: 'photo-1', uidFrom: 'friend', idTo: 'me', ts: 1000,
    msgType: 'chat.photo', content: {
      href: 'https://f1.zdn.vn/qr.jpg', title: 'Đây là mã QR thanh toán'
    }
  } });
  assert.equal(message.isPhoto, true);
  assert.equal(message.photoCaption, 'Đây là mã QR thanh toán');
  assert.equal(message.content, '[Hình ảnh]');
});

test('photo attachment with a file name remains an image with its caption', () => {
  const manager = createManager();
  const message = manager.formatMessage({ type: 0, data: {
    msgId: 'photo-named', uidFrom: 'friend', idTo: 'me', ts: 1000,
    msgType: 'chat.photo', content: { href: 'https://f1.zdn.vn/qr.jpg',
      name: 'qr.jpg', title: 'Quét mã này nhé' }
  } });
  assert.equal(message.isFile, false);
  assert.equal(message.photoUrl, 'https://f1.zdn.vn/qr.jpg');
  assert.equal(message.photoCaption, 'Quét mã này nhé');
});

test('photo caption helper preserves old text but excludes a bare image URL', () => {
  const captions = require('../src/shared/photoCaption');
  assert.equal(captions.getPhotoCaption({ isPhoto: true, content: 'Đã gửi mã QR' }), 'Đã gửi mã QR');
  assert.equal(captions.getPhotoCaption({ isPhoto: true, content: 'https://f1.zdn.vn/qr.jpg' }), '');
  assert.equal(captions.getPhotoCaption({ isPhoto: true, content: '[Hình ảnh]' }), '');
  assert.equal(captions.getPhotoCaption({ isPhoto: true, photoCaption: '<b>QR</b>' }), '<b>QR</b>');
});

test('phone backup preserves a photo caption alongside its decoded image URL', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-caption-backup-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup);
  const db = new DatabaseSync(path.join(backup, '123456789.db'));
  db.exec('CREATE TABLE ChatContent (GlbMsgId TEXT, CliMsgId TEXT, TimeStamp INTEGER, SenderId TEXT, MsgType INTEGER, MsgContent TEXT, MsgStatus INTEGER, BinNet BLOB)');
  db.prepare('INSERT INTO ChatContent VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'photo-1', 'cli-1', 1000, '123456789', 3, 'Mã QR thanh toán', 1, Buffer.from('photo'));
  db.close();
  const Store = require('../src/main/messageStore');
  const store = new Store(path.join(root, 'messages.sqlite'));
  const { importDecryptedBackup } = require('../src/main/phoneBackupImport');
  await importDecryptedBackup({ folder: backup, store, accountId: '555555555',
    parseBinNetBatch: async items => [{ index: items[0].index,
      photoUrl: 'https://f1.zdn.vn/qr.jpg' }] });
  const message = store.getThread('123456789')[0];
  assert.equal(message.photoUrl, 'https://f1.zdn.vn/qr.jpg');
  assert.equal(message.photoCaption, 'Mã QR thanh toán');
});

test('Zalo native photo attachment title is decoded as a caption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-caption-native-'));
  const folder = path.join(root, 'resources', 'app.asar.unpacked',
    'native', 'nativelibs', 'db-cross-v4', 'dist');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'binding.js'),
    "exports.parseBinNet = () => ({ result: 0, data: { attachs: [{ href: 'https://f1.zdn.vn/qr.jpg', title: 'Lời nhắn kèm ảnh' }] } });\n");
  const child = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'src', 'main', 'zaloBackupMediaChild.js')], {
      input: JSON.stringify({ zaloDirectory: root, items: [{ index: 0, msgType: 3,
        binNet: Buffer.from('sample').toString('base64') }] }), encoding: 'utf8'
    });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).results[0].photoCaption, 'Lời nhắn kèm ảnh');
});

test('recent Zalo history can restore a missing caption without replacing the image', () => {
  const manager = createManager();
  manager.messageStore.put({ id: 'photo-1', cliMsgId: 'cli-1', threadId: '123456789',
    isPhoto: true, photoUrl: 'https://f1.zdn.vn/qr.jpg', content: '[Hình ảnh]', timestamp: 1 });
  manager.messagesHistory = manager.messageStore.getRecent();
  const updated = manager.enrichExistingPhotoCaption({ id: 'photo-1', cliMsgId: 'cli-1',
    threadId: '123456789', isPhoto: true, photoCaption: 'Chuyển khoản giúp tôi' });
  assert.equal(updated.photoCaption, 'Chuyển khoản giúp tôi');
  assert.equal(manager.messageStore.getThread('123456789')[0].photoCaption, 'Chuyển khoản giúp tôi');
  assert.equal(manager.messageStore.getThread('123456789')[0].photoUrl, 'https://f1.zdn.vn/qr.jpg');
  assert.equal(manager.messagesHistory[0].photoCaption, 'Chuyển khoản giúp tôi');
});

test('automatic recent history refreshes the caption of a known photo', async () => {
  const manager = createManager();
  manager.messageStore.put({ id: 'photo-2', cliMsgId: 'cli-2', threadId: '123456789',
    isPhoto: true, photoUrl: 'https://f1.zdn.vn/qr.jpg', content: '[Hình ảnh]', timestamp: 1 });
  manager.messagesHistory = manager.messageStore.getRecent();
  manager.api = {};
  manager.listener = { ws: { readyState: 1 } };
  manager.requestRecentPage = async type => type === 0 ? [{ type: 0, data: {
    msgId: 'photo-2', cliMsgId: 'cli-2', uidFrom: '123456789', idTo: 'me', ts: 1,
    msgType: 'chat.photo', content: { href: 'https://f1.zdn.vn/qr.jpg',
      title: 'Chuyển khoản giúp tôi' }
  } }] : [];
  const events = [];
  manager.onPhotoCaptionUpdate = event => events.push(event);
  await manager.catchUpRecentMessages();
  assert.equal(manager.messageStore.getThread('123456789')[0].photoCaption, 'Chuyển khoản giúp tôi');
  assert.equal(events.length, 1);
});
