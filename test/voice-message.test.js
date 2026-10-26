const test = require('node:test');
const assert = require('node:assert/strict');
const { getVoicePresentation } = require('../src/renderer/dashboard/voiceMessage');

test('voice URL renders as playable audio', () => {
  assert.deepEqual(getVoicePresentation({ msgType: 'chat.voice', content: 'https://f1.voice.talk.zdn.vn/a.amr' }), {
    isVoice: true, url: 'https://f1.voice.talk.zdn.vn/a.amr', duration: ''
  });
});

test('voice player prefers m4a when both native URLs are present', () => {
  assert.equal(getVoicePresentation({ msgType: 'chat.voice',
    voiceUrl: 'https://f1.voice.talk.zdn.vn/a.amr',
    m4aUrl: 'https://f1.voice.talk.zdn.vn/a.m4a' }).url,
  'https://f1.voice.talk.zdn.vn/a.m4a');
});

test('backup duration without media shows an honest unavailable voice card', () => {
  assert.deepEqual(getVoicePresentation({ msgType: 'chat.recommended', content: '0:8' }), {
    isVoice: true, url: '', duration: '0:08'
  });
  assert.equal(getVoicePresentation({ msgType: 'webchat', content: '0:8' }).isVoice, false);
});
