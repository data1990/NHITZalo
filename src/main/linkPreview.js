const dns = require('node:dns').promises;
const net = require('node:net');

function decodeEntities(value) {
  return String(value || '').replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (entity[0] !== '#') return named[entity.toLowerCase()] || _;
    const code = entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code) : _;
  });
}

function cleanText(value) {
  return decodeEntities(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function safeHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : '';
  } catch (_) { return ''; }
}

function parseHtmlMetadata(html, pageUrl) {
  const meta = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    }
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const image = safeHttpUrl(decodeEntities(meta.get('og:image') || meta.get('twitter:image') || ''), pageUrl);
  return {
    title: cleanText(meta.get('og:title') || meta.get('twitter:title') || titleTag),
    description: cleanText(meta.get('og:description') || meta.get('twitter:description') || meta.get('description')),
    image
  };
}

function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
    return !(lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower));
  }
  return false;
}

async function assertPublicUrl(value, lookupImpl) {
  const safe = safeHttpUrl(value);
  if (!safe) throw new Error('Đường dẫn không hợp lệ');
  const url = new URL(safe);
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local') || !url.hostname.includes('.')) {
    throw new Error('Chỉ hỗ trợ đường dẫn web công khai');
  }
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Cổng web không hợp lệ');
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }] : await lookupImpl(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('Chỉ hỗ trợ đường dẫn web công khai');
  }
  return safe;
}

async function fetchLinkPreview(value, { fetchImpl = fetch, lookupImpl = dns.lookup } = {}) {
  let url = value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (let redirect = 0; redirect < 4; redirect++) {
      url = await assertPublicUrl(url, lookupImpl);
      const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 NHITZalo/1.0' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Trang chuyển hướng thiếu địa chỉ');
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) throw new Error(`Không tải được trang (HTTP ${response.status})`);
      if (!/html/i.test(response.headers.get('content-type') || '')) throw new Error('Đường dẫn không phải trang web');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      let bytes = 0;
      while (bytes < 512 * 1024) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.length;
        html += decoder.decode(chunk, { stream: true });
        if (html.includes('</head>')) break;
      }
      await reader.cancel().catch(() => {});
      return parseHtmlMetadata(html, url);
    }
    throw new Error('Trang chuyển hướng quá nhiều lần');
  } finally { clearTimeout(timer); }
}

module.exports = { parseHtmlMetadata, fetchLinkPreview, safeHttpUrl };
