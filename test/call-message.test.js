const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCallMessage } = require('../src/shared/callMessage');

test('old call placeholders show the known call direction', () => {
  assert.equal(describeCallMessage({ content: 'sendBubbleMessage - Cuộc gọi', isSelf: true }), 'Cuộc gọi thoại đi');
  assert.equal(describeCallMessage({ content: 'sendBubbleMessage - Cuộc gọi', isSelf: false }), 'Cuộc gọi thoại đến');
  assert.equal(describeCallMessage({ content: 'sendBubbleMessage', isSelf: false }), 'sendBubbleMessage');
});

test('missed and video call metadata keep their specific status', () => {
  assert.equal(describeCallMessage({ content: 'sendBubbleMessage - Cuộc gọi', isSelf: false,
    callStatus: 'missed' }), 'Cuộc gọi thoại nhỡ');
  assert.equal(describeCallMessage({ content: 'sendBubbleMessage - Cuộc gọi video nhỡ', isSelf: false }), 'Cuộc gọi video nhỡ');
  assert.equal(describeCallMessage({ content: 'Tin nhắn bình thường', isSelf: true }), 'Tin nhắn bình thường');
});

test('old recommended duration displays a call with direction instead of an unavailable recording', () => {
  assert.equal(describeCallMessage({ msgType: 'chat.recommended', content: '0:26', isSelf: false }),
    'Cuộc gọi thoại đến · 0:26');
  assert.equal(describeCallMessage({ msgType: 'chat.recommended', content: '0:8', isSelf: true }),
    'Cuộc gọi thoại đi · 0:08');
  assert.equal(describeCallMessage({ msgType: 'chat.recommended', content: '0:26',
    voiceUrl: 'https://f1.voice.talk.zdn.vn/a.amr' }), '0:26');
});
