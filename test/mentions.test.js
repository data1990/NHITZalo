const test = require('node:test');
const assert = require('node:assert/strict');
const { getMentionSegments, parseMentionMetadata, renderMentionHtml } = require('../src/shared/mentions');

test('explicit Zalo mention UID makes only the tagged name clickable', () => {
  const text = 'Chào @Trần Thị Đông nhầm kia';
  const segments = getMentionSegments({ isGroup: true, content: text,
    mentions: [{ pos: 5, len: 14, uid: '1234567890123456789' }] });
  assert.deepEqual(segments, [
    { text: 'Chào ' },
    { text: '@Trần Thị Đông', uid: '1234567890123456789' },
    { text: ' nhầm kia' }
  ]);
});

test('old text-only mention links a uniquely named contact without consuming following words', () => {
  const segments = getMentionSegments({ isGroup: true, content: '@Trần Thị Đông nhầm kia' }, [
    { id: '1234567890123456789', name: 'Trần Thị Đông' },
    { id: '9876543210123456789', name: 'Trần Thị' }
  ]);
  assert.deepEqual(segments, [
    { text: '@Trần Thị Đông', uid: '1234567890123456789' },
    { text: ' nhầm kia' }
  ]);
});

test('ambiguous names and plain personal chat text never open a guessed contact', () => {
  const candidates = [
    { id: '1234567890123456789', name: 'An' },
    { id: '9876543210123456789', name: 'An' }
  ];
  assert.deepEqual(getMentionSegments({ isGroup: true, content: '@An xem giúp' }, candidates),
    [{ text: '@An xem giúp' }]);
  assert.deepEqual(getMentionSegments({ isGroup: false, content: '@An xem giúp' }, candidates),
    [{ text: '@An xem giúp' }]);
});

test('mention metadata accepts Zalo JSON format and ignores invalid IDs', () => {
  assert.deepEqual(parseMentionMetadata('[{"pos":0,"len":3,"uid":"1234567890123456789"}]'),
    [{ pos: 0, len: 3, uid: '1234567890123456789' }]);
  assert.deepEqual(parseMentionMetadata([{ pos: 0, len: 3, uid: 'javascript:alert(1)' }]), []);
});

test('mention HTML escapes surrounding message and carries only a numeric target', () => {
  const html = renderMentionHtml({ isGroup: true, content: 'Nhắn @Lan <script>' }, [
    { id: '1234567890123456789', name: 'Lan' }
  ]);
  assert.match(html, /data-mention-uid="1234567890123456789"/);
  assert.match(html, /@Lan<\/button>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
