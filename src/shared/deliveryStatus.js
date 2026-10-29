(function (root) {
  const ranks = { sent: 1, delivered: 2, seen: 3 };

  function promoteDeliveryStatus(current, next) {
    return (ranks[next] || 0) > (ranks[current] || 0) ? next : current || '';
  }

  function normalizeReceipt(receipt, status) {
    if (!receipt || !['delivered', 'seen'].includes(status) || receipt.isSelf) return null;
    const threadId = String(receipt.threadId || '');
    const data = receipt.data || {};
    const messageIds = [...new Set([data.realMsgId, data.msgId].map(String).filter(id => id && id !== 'undefined'))];
    if (!threadId || messageIds.length === 0) return null;
    return { threadId, isGroup: Number(receipt.type) === 1, messageIds, status };
  }

  function deliveryStatusLabel(message) {
    if (!message?.isSelf) return '';
    const status = message.deliveryStatus || 'sent';
    if (message.isGroup) return { sent: 'Đã gửi', delivered: 'Có người đã nhận', seen: 'Có người đã xem' }[status] || '';
    return { sent: 'Đã gửi', delivered: 'Đã nhận', seen: 'Đã xem' }[status] || '';
  }

  const api = { normalizeReceipt, promoteDeliveryStatus, deliveryStatusLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DeliveryStatus = api;
})(typeof window !== 'undefined' ? window : null);
