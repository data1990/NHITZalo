const test = require('node:test');
const assert = require('node:assert/strict');
const { getClipboardImageFile } = require('../src/shared/clipboardImage');

test('pasted screenshots are found in clipboard items or files', () => {
  const image = { type: 'image/png' };
  assert.equal(getClipboardImageFile({ items: [
    { type: 'text/plain', getAsFile: () => null },
    { type: 'image/png', getAsFile: () => image }
  ] }), image);
  assert.equal(getClipboardImageFile({ items: [], files: [image] }), image);
  assert.equal(getClipboardImageFile({ items: [{ type: 'text/plain' }], files: [] }), null);
});
