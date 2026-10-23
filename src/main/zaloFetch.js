const https = require('https');
const http = require('http');
const zlib = require('zlib');
const dns = require('dns');

// Cấu hình danh sách DNS an toàn dự phòng (Google, Cloudflare) để tránh timeout DNS ở router cục bộ
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // Bỏ qua nếu môi trường không cho phép setServers
}

/**
 * Polyfill fetch thuần Node.js thay thế cho fetch của Chromium / Electron
 * Khắc phục hoàn toàn lỗi cấm Forbidden Headers (Cookie, Origin, Referer) và lỗi fetch failed trong Electron.
 */
function zaloFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      return reject(err);
    }

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const reqHeaders = { ...(options.headers || {}) };

    let sendBody = null;
    let isStream = false;

    if (options.body) {
      if (typeof options.body === 'string') {
        sendBody = Buffer.from(options.body, 'utf8');
      } else if (Buffer.isBuffer(options.body)) {
        sendBody = options.body;
      } else if (options.body instanceof URLSearchParams || (options.body && options.body.constructor && options.body.constructor.name === 'URLSearchParams') || (options.body && typeof options.body.toString === 'function' && options.body.toString().startsWith('params='))) {
        sendBody = Buffer.from(options.body.toString(), 'utf8');
        if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        }
      } else if (typeof options.body.getBuffer === 'function') {
        sendBody = options.body.getBuffer();
        if (typeof options.body.getHeaders === 'function') {
          Object.assign(reqHeaders, options.body.getHeaders());
        }
      } else if (typeof options.body.pipe === 'function') {
        isStream = true;
      } else {
        sendBody = Buffer.from(JSON.stringify(options.body), 'utf8');
        if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json;charset=UTF-8';
        }
      }
    }

    if (sendBody && !reqHeaders['content-length'] && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(sendBody);
    }

    // Tự động yêu cầu nén để tối ưu tốc độ mạng
    if (!reqHeaders['accept-encoding'] && !reqHeaders['Accept-Encoding']) {
      reqHeaders['Accept-Encoding'] = 'gzip, deflate, br';
    }

    const reqOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: (options.method || 'GET').toUpperCase(),
      headers: reqHeaders,
      timeout: 20000 // 20 giây timeout an toàn
    };

    const req = lib.request(reqOptions, (res) => {
      // Xử lý chuyển hướng HTTP (301, 302, 307, 308)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        return zaloFetch(redirectUrl, {
          ...options,
          method: (res.statusCode === 303 || res.statusCode === 301 || res.statusCode === 302) ? 'GET' : options.method,
          body: (res.statusCode === 303 || res.statusCode === 301 || res.statusCode === 302) ? undefined : options.body
        }).then(resolve).catch(reject);
      }

      let stream = res;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }

      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const headersLower = {};
        for (const [key, val] of Object.entries(res.headers)) {
          headersLower[key.toLowerCase()] = val;
        }

        const responseObj = {
          status: res.statusCode,
          statusText: res.statusMessage,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: {
            get(name) {
              const val = headersLower[name.toLowerCase()];
              return Array.isArray(val) ? val.join(', ') : (val || null);
            },
            getSetCookie() {
              const sc = res.headers['set-cookie'];
              if (!sc) return [];
              return Array.isArray(sc) ? sc : [sc];
            }
          },
          text: async () => bodyBuffer.toString('utf8'),
          json: async () => {
            const str = bodyBuffer.toString('utf8');
            return JSON.parse(str);
          },
          buffer: async () => bodyBuffer
        };

        resolve(responseObj);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Zalo request timed out: ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (isStream) {
      options.body.pipe(req);
    } else if (sendBody) {
      req.write(sendBody);
      req.end();
    } else {
      req.end();
    }
  });
}

module.exports = { zaloFetch };
