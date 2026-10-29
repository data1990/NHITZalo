const test = require('node:test');
const assert = require('node:assert/strict');
const { getVoicePresentation, getVoiceFallbackUrl, handleVoicePlaybackError } = require('../src/renderer/dashboard/voiceMessage');

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

test('a call duration in a recommended message is not mistaken for a voice recording', () => {
  assert.deepEqual(getVoicePresentation({ msgType: 'chat.recommended', content: '0:8' }), {
    isVoice: false, url: '', duration: ''
  });
  assert.equal(getVoicePresentation({ msgType: 'chat.recommended', content: '0:8',
    m4aUrl: 'https://f1.voice.talk.zdn.vn/a.m4a' }).url, 'https://f1.voice.talk.zdn.vn/a.m4a');
  assert.equal(getVoicePresentation({ msgType: 'webchat', content: '0:8' }).isVoice, false);
});

test('voice playback can retry a different recording URL after the preferred link fails', () => {
  assert.equal(getVoiceFallbackUrl({
    voiceUrl: 'https://f1.voice.talk.zdn.vn/a.amr',
    m4aUrl: 'https://f1.voice.talk.zdn.vn/a.m4a'
  }), 'https://f1.voice.talk.zdn.vn/a.amr');
  assert.equal(getVoiceFallbackUrl({ voiceUrl: 'https://f1.voice.talk.zdn.vn/a.aac',
    m4aUrl: 'https://f1.voice.talk.zdn.vn/a.aac' }), '');
});

test('failed voice playback retries once, then reveals an unavailable message', () => {
  const notice = { hidden: true };
  const audio = { dataset: { voiceFallback: 'https://example.com/voice.amr' },
    src: 'https://example.com/voice.m4a', hidden: false, nextElementSibling: notice,
    load() { this.loaded = true; } };
  handleVoicePlaybackError(audio);
  assert.equal(audio.src, 'https://example.com/voice.amr');
  assert.equal(audio.loaded, true);
  handleVoicePlaybackError(audio);
  assert.equal(audio.hidden, true);
  assert.equal(notice.hidden, false);
});
