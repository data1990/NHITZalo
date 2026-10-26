const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('all message reaction icons start with a valid SVG document', () => {
  const icons = ['Heart', 'Like', 'Smile', 'Surprised', 'Cry', 'Rage'];
  for (const icon of icons) {
    const file = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'zalo-icons', `${icon}_24_emoji.svg`);
    const bytes = fs.readFileSync(file);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.match(source, /^\s*<svg\b/, `${icon} must begin with <svg>`);
    assert.match(source, /<\/svg>\s*$/, `${icon} must end with </svg>`);
  }
});
