const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FileDownloads = require('../src/main/fileDownloads');

function fixture(fetcher = async () => new Response('file body')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-files-'));
  const account = path.join(root, 'account');
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads);
  return { root, account, downloads, manager: new FileDownloads(account, downloads, fetcher) };
}

test('file downloads default to manual and keep settings per account', () => {
  const { account, downloads, manager, root } = fixture();
  assert.deepEqual(manager.getSettings(), { mode: 'manual', directory: downloads });
  const chosen = path.join(root, 'chosen');
  fs.mkdirSync(chosen);
  manager.setSettings({ mode: 'automatic', directory: chosen });
  assert.deepEqual(new FileDownloads(account, downloads).getSettings(),
    { mode: 'automatic', directory: chosen });
  assert.throws(() => manager.setSettings({ directory: path.join(root, 'missing') }), /thư mục/i);
});

test('manual download records URL, reuses existing file, and survives restart', async () => {
  let requests = 0;
  const { account, downloads, manager } = fixture(async () => { requests++; return new Response('file body'); });
  const url = 'https://example.com/report.pdf?token=1';
  const first = await manager.download(url, 'report.pdf');
  assert.equal(first.success, true);
  assert.equal(path.dirname(first.filePath), downloads);
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), 'file body');
  const again = await manager.download(url, 'report.pdf');
  assert.equal(again.existing, true);
  assert.equal(requests, 1);
  assert.equal(new FileDownloads(account, downloads).lookup([{ url, fileName: 'report.pdf' }])[url], first.filePath);
  fs.unlinkSync(first.filePath);
  assert.equal(manager.lookup([{ url, fileName: 'report.pdf' }])[url], undefined);
});

test('automatic mode downloads new incoming files once, while manual mode does not', async () => {
  let requests = 0;
  const { root, manager } = fixture(async () => { requests++; return new Response('ok'); });
  const message = { fileUrl: 'https://example.com/a.zip', fileName: 'a.zip', isFile: true };
  assert.equal(await manager.onMessage(message, false), null);
  const target = path.join(root, 'chosen'); fs.mkdirSync(target);
  manager.setSettings({ mode: 'automatic', directory: target });
  assert.equal(await manager.onMessage(message, true), null);
  assert.equal(await manager.onMessage({ ...message, isSelf: true }, false), null);
  const result = await manager.onMessage(message, false);
  assert.equal(result.success, true);
  assert.equal(path.dirname(result.filePath), target);
  await manager.onMessage(message, false);
  assert.equal(requests, 1);
});

test('matching an old file requires expected size and failed transfers leave no partial file', async () => {
  const { downloads, manager } = fixture(async () => new Response('failure', { status: 403 }));
  const url = 'https://example.com/old.zip';
  fs.writeFileSync(path.join(downloads, 'old.zip'), 'old body');
  assert.equal(manager.lookup([{ url, fileName: 'old.zip' }])[url], undefined);
  assert.equal(manager.lookup([{ url, fileName: 'old.zip', fileSize: 8 }])[url], path.join(downloads, 'old.zip'));
  const result = await manager.download('https://example.com/new.zip', 'new.zip');
  assert.equal(result.success, false);
  assert.equal(fs.readdirSync(downloads).some(name => name.includes('new.zip')), false);
});

test('simultaneous downloads of one URL share one transfer and file names stay inside the chosen folder', async () => {
  let requests = 0;
  const { downloads, manager } = fixture(async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response('payload');
  });
  const url = 'https://example.com/data.bin';
  const [first, second] = await Promise.all([
    manager.download(url, '..\\..\\data.bin'), manager.download(url, '..\\..\\data.bin')
  ]);
  assert.equal(requests, 1);
  assert.equal(first.filePath, second.filePath);
  assert.equal(path.dirname(first.filePath), downloads);
});
