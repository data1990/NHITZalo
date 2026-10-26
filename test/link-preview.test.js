const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function createManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhitzalo-link-'));
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
  } finally {
    Module._load = load;
  }
}

test('Zalo link metadata survives message formatting', () => {
  const manager = createManager();
  const message = manager.formatMessage({ type: 0, data: {
    msgId: 'link-1', uidFrom: 'friend', idTo: 'me', ts: 1000, msgType: 'chat.link',
    content: { href: 'https://example.com/item', title: 'A product',
      description: 'Product description', thumb: 'https://example.com/item.jpg' }
  } });
  assert.equal(message.linkUrl, 'https://example.com/item');
  assert.deepEqual(message.linkPreview, { title: 'A product', description: 'Product description',
    image: 'https://example.com/item.jpg' });
});

test('link card recognizes old text links and escapes metadata', () => {
  const links = require('../src/renderer/dashboard/linkPreview');
  const message = { content: 'Xem https://example.com/item?x=1' };
  assert.equal(links.getMessageUrl(message), 'https://example.com/item?x=1');
  const html = links.renderCard(message, { title: '<script>alert(1)</script>',
    description: 'Mô tả', image: 'https://example.com/item.jpg' });
  assert.match(html, /example\.com/);
  assert.match(html, /chat-link-preview-image/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(links.getMessageUrl({ content: 'file:///C:/secret' }), '');
  const archived = links.renderCard({ isLink: true, linkUrl: 'https://example.com/item',
    content: 'https://example.com/item - Product description' }, { title: 'Product' });
  assert.doesNotMatch(archived, /chat-link-message/);
});

test('HTML metadata supplies title, description and relative image', () => {
  const { parseHtmlMetadata } = require('../src/main/linkPreview');
  const result = parseHtmlMetadata(`<!doctype html><html><head>
    <meta content="Nguồn máy tính Jetek NS400 V2" property="og:title">
    <meta name="description" content="Giải pháp nguồn ổn định">
    <meta property="og:image" content="/products/power.jpg">
  </head></html>`, 'https://example.com/products/power');
  assert.deepEqual(result, { title: 'Nguồn máy tính Jetek NS400 V2',
    description: 'Giải pháp nguồn ổn định', image: 'https://example.com/products/power.jpg' });
});

test('metadata fetch rejects local URLs and limits response size', async () => {
  const { fetchLinkPreview } = require('../src/main/linkPreview');
  await assert.rejects(() => fetchLinkPreview('http://127.0.0.1/private'), /công khai|hợp lệ/i);
  let called = 0;
  const fetchImpl = async () => {
    called++;
    return new Response('<meta property="og:title" content="Sample">',
      { headers: { 'content-type': 'text/html' } });
  };
  const result = await fetchLinkPreview('https://example.com/page', {
    fetchImpl, lookupImpl: async () => [{ address: '93.184.216.34' }]
  });
  assert.equal(result.title, 'Sample');
  assert.equal(called, 1);
});
