function safeAudioUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s<>"']+$/i.test(url) ? url : '';
}

function getVoiceFallbackUrl(message) {
  const primary = safeAudioUrl(message?.m4aUrl || message?.voiceUrl);
  const alternate = safeAudioUrl(message?.voiceUrl);
  return alternate && alternate !== primary ? alternate : '';
}

function getVoicePresentation(message) {
  const content = String(message?.content || '').trim();
  const type = String(message?.msgType || '');
  const isDuration = /^\d{1,2}:\d{1,2}$/.test(content);
  // Zalo stores call durations as chat.recommended. Only its audio attachment
  // makes a recommended message a playable voice recording.
  const isVoice = type === 'chat.voice' ||
    (type === 'chat.recommended' && Boolean(message?.voiceUrl || message?.m4aUrl));
  if (!isVoice) return { isVoice: false, url: '', duration: '' };
  const url = safeAudioUrl(message?.m4aUrl || message?.voiceUrl ||
    (content.startsWith('https://') ? content : ''));
  const duration = isDuration
    ? content.replace(/:(\d)$/, ':0$1')
    : String(message?.voiceDuration || '');
  return { isVoice: true, url, duration };
}

function handleVoicePlaybackError(audio) {
  const fallback = safeAudioUrl(audio?.dataset?.voiceFallback);
  if (fallback) {
    audio.dataset.voiceFallback = '';
    audio.src = fallback;
    audio.load();
    return;
  }
  audio.hidden = true;
  if (audio.nextElementSibling) audio.nextElementSibling.hidden = false;
}

const VoiceMessage = { getVoicePresentation, getVoiceFallbackUrl, handleVoicePlaybackError };
if (typeof module !== 'undefined' && module.exports) module.exports = VoiceMessage;
if (typeof window !== 'undefined') {
  window.VoiceMessage = VoiceMessage;
  document.addEventListener('error', event => {
    if (event.target?.matches?.('audio[data-voice-fallback]')) handleVoicePlaybackError(event.target);
  }, true);
}
