const fs = require('fs');
const { Zalo } = require('zalo-api-final');
const { zaloFetch } = require('../src/main/zaloFetch');

const session = JSON.parse(fs.readFileSync('C:\\Users\\Admin\\AppData\\Roaming\\nhitzalo\\zalo_session.json', 'utf8'));
const zalo = new Zalo({
  selfListen: false,
  checkUpdate: false,
  logging: false,
  polyfill: zaloFetch
});

async function run() {
  const api = await zalo.login({
    imei: session.imei,
    cookie: session.cookie,
    userAgent: session.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  console.log('Login OK!');
  
  const keywords = ['vui', 'chao', 'yeu', 'khoc', 'haha', 'ok', 'cam on'];
  for (const kw of keywords) {
    try {
      const ids = await api.getStickers(kw);
      console.log(`Keyword "${kw}": found ${ids ? ids.length : 0} stickers:`, ids ? ids.slice(0, 5) : []);
    } catch (e) {
      console.log(`Keyword "${kw}" error:`, e.message);
    }
  }
}

run().catch(e => console.error(e));
