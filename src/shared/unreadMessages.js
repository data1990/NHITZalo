(function (root) {
  function isIncomingMessage(message) {
    if (!message || message.isSelf || message.senderName === 'Bạn (Tôi)') return false;
    const senderId = String(message.senderId || '');
    return senderId !== 'self' && senderId !== 'me' && senderId !== '0';
  }

  function countIncomingMessages(messages, after = 0) {
    return (messages || []).filter(message =>
      isIncomingMessage(message) && (!after || Number(message.timestamp || 0) > after)).length;
  }

  const api = { isIncomingMessage, countIncomingMessages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UnreadMessages = api;
})(typeof window !== 'undefined' ? window : null);
