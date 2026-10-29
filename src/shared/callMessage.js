(function (root) {
  function describeCallMessage(message) {
    const raw = String(message?.content || '').trim();
    if (message?.msgType === 'chat.recommended' && /^\d{1,2}:\d{1,2}$/.test(raw) &&
        !message?.voiceUrl && !message?.m4aUrl) {
      const duration = raw.replace(/:(\d)$/, ':0$1');
      const kind = /video|hình/i.test(String(message?.callType || '')) ? 'video' : 'thoại';
      return `Cuộc gọi ${kind} ${message?.isSelf ? 'đi' : 'đến'} · ${duration}`;
    }
    const callText = raw.match(/^sendBubbleMessage\s*[-–:]\s*(Cuộc gọi.*)$/i)?.[1] || raw;
    const isCall = /^Cuộc gọi(?:\s|$)/i.test(callText) &&
      (/^sendBubbleMessage\s*[-–:]/i.test(raw) || /call/i.test(String(message?.msgType || '')));
    if (!isCall) return raw;

    const detail = [callText, message?.callStatus, message?.status,
      message?.callType, message?.type].filter(value => typeof value === 'string').join(' ').toLowerCase();
    const kind = /video|hình/.test(detail) ? 'video' : 'thoại';
    const missed = /nhỡ|missed|no.?answer|không bắt máy/.test(detail);
    const declined = /từ chối|declined|rejected/.test(detail);
    const cancelled = /đã hủy|cancelled|canceled/.test(detail);
    const status = missed ? 'nhỡ' : declined ? 'bị từ chối' : cancelled ? 'đã hủy'
      : message?.isSelf ? 'đi' : 'đến';
    return `Cuộc gọi ${kind} ${status}`;
  }

  const api = { describeCallMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CallMessage = api;
})(typeof window !== 'undefined' ? window : null);
