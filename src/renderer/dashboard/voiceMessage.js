function getVoicePresentation(message) {
  const content = String(message?.content || '').trim();
  const type = String(message?.msgType || '');
  const isDuration = /^\d{1,2}:\d{1,2}$/.test(content);
  const isVoice = type === 'chat.voice' || (type === 'chat.recommended' && isDuration);
  if (!isVoice) return { isVoice: false, url: '', duration: '' };
  const candidate = String(message?.m4aUrl || message?.voiceUrl || (content.startsWith('https://') ? content : '')).trim();
  const url = /^https:\/\/[^\s<>"']+$/i.test(candidate) ? candidate : '';
  const duration = isDuration
    ? content.replace(/:(\d)$/, ':0$1')
    : String(message?.voiceDuration || '');
  return { isVoice: true, url, duration };
}

const VoiceMessage = { getVoicePresentation };
if (typeof module !== 'undefined' && module.exports) module.exports = VoiceMessage;
if (typeof window !== 'undefined') window.VoiceMessage = VoiceMessage;
