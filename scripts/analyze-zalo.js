const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Zalo\\Zalo-26.10.20\\resources\\app.asar';
if (!fs.existsSync(asarPath)) {
  console.error('Asar not found at:', asarPath);
  process.exit(1);
}

const fd = fs.openSync(asarPath, 'r');
const headerSizeBuf = Buffer.alloc(16);
fs.readSync(fd, headerSizeBuf, 0, 16, 0);
const jsonLen = headerSizeBuf.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
const tree = JSON.parse(jsonBuf.toString('utf8'));

console.log('Asar parsed successfully. Header size:', jsonLen);

function extractFile(relativeAsarPath, destinationPath) {
  let curr = tree;
  for (const part of relativeAsarPath.split('/')) {
    if (!curr.files || !curr.files[part]) return false;
    curr = curr.files[part];
  }
  if (typeof curr.offset === 'undefined') return false;
  const offset = 16 + jsonLen + parseInt(curr.offset, 10);
  const buf = Buffer.alloc(curr.size);
  fs.readSync(fd, buf, 0, curr.size, offset);
  
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, buf);
  return true;
}

// 1. Trích xuất toàn bộ SVG reactions và chat icons chính hãng của Zalo
const assetsDir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'zalo-icons');
fs.mkdirSync(assetsDir, { recursive: true });

const targetIcons = [
  'Heart_24_emoji.99e5f54532ebece3ab3fea2a15dc889c.svg',
  'Like_24_emoji.d52d709508a3702a70e803c13481d0cf.svg',
  'Smile_24_emoji.33788563cc9d74ac0efcba6e9ccd6aa8.svg',
  'Surprised_24_emoji.284cbe46f81efdcb94e2b6abdea863b5.svg',
  'Cry_24_emoji.506a172f5170d18a0d394e52ef7a9a03.svg',
  'Rage_24_emoji.196545ca8b38379f97a674171f56a934.svg',
  'icon-photo.1ef82b2ce3e302f5e186a8c54f74252f.svg',
  'icon-gif.9f9c98ce9e5543505f47b5ae4aac3178.svg',
  'icon-suggest-sticker.b73cdbada2f92b2840ce4d60e9269250.svg',
  'emoji_emoji.b2ae347f428946c5de0c9450fb5209f5.svg',
  'emoji_activity.63de70dfe259f03500e27ab8ef88d489.svg',
  'File_Image_24_Line.532e04f61a4b3107f4d5e8646fd4ff0e.svg',
  'Media_Photo.40bedd64db294cfb5db92f06ba484108.svg',
  'icon-folder.4cec262bfbdd7cff3365e06066523005.svg',
  'icon-voice.e4835a33c7b8593295c15c922204c948.svg',
  'icon-video.7636eeed2fddb86a487d53b6bea0461e.svg',
  'chat-menu-star-on.aafbc5998bbd0ddcb55ac809d199a9fe.svg',
  'icon-lock.f288e209c9cc1b1721622dc60576c49a.svg'
];

console.log('Extracting official Zalo SVGs to:', assetsDir);
for (const iconFile of targetIcons) {
  const asarPath = 'pc-dist/assets/' + iconFile;
  // Clean name without hash for convenience
  const cleanName = iconFile.replace(/\.[a-f0-9]{32}\.svg$/, '.svg');
  const destPath = path.join(assetsDir, cleanName);
  const ok = extractFile(asarPath, destPath);
  console.log(`- ${cleanName}: ${ok ? 'OK' : 'FAILED'}`);
}

// 2. Tìm kiếm cách Zalo render Sticker, Photo và Emoji
console.log('\n--- Analyzing Image & Sticker & Emoji Handlers in Zalo ---');
function readChunk(relativeAsarPath, maxBytes = 2000000) {
  let curr = tree;
  for (const part of relativeAsarPath.split('/')) {
    if (!curr.files || !curr.files[part]) return null;
    curr = curr.files[part];
  }
  const offset = 16 + jsonLen + parseInt(curr.offset, 10);
  const size = Math.min(curr.size, maxBytes);
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, offset);
  return buf.toString('utf8');
}

const mainCode = readChunk('pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 10000000);
if (mainCode) {
  // Tìm kiếm pattern sticker URL
  const stickerPatterns = [
    /https:\/\/[^"'\s]*sticker[^"'\s]*/gi,
    /https:\/\/[^"'\s]*emoticon[^"'\s]*/gi,
    /getStickerUrl[^{}]*\{[^}]*\}/gi,
    /getPhotoUrl[^{}]*\{[^}]*\}/gi
  ];
  
  for (const pat of stickerPatterns) {
    const matches = mainCode.match(pat);
    if (matches) {
      console.log('Pattern match found count:', matches.length);
      console.log('Samples:', [...new Set(matches)].slice(0, 5));
    }
  }
}

fs.closeSync(fd);
console.log('\nAnalysis completed.');
