(function (root) {
  function asObject(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function firstText(...values) {
    return values.find(value => typeof value === 'string' && value.trim()) || '';
  }

  function normalizePinnedBoards(boards) {
    if (!Array.isArray(boards)) return [];
    return boards.filter(item => Number(item?.boardType) === 2).map(item => {
      const data = asObject(item.data);
      const params = asObject(data.params);
      const message = asObject(params.message || params.msg);
      const messageId = params.msgId ?? params.msg_id ?? params.gMsgId ?? params.globalMsgId
        ?? params.global_msg_id ?? params.client_msg_id
        ?? message.msgId ?? message.msg_id ?? message.id;
      const boardId = data.id == null ? '' : String(data.id);
      return {
        id: messageId == null ? `board:${boardId}` : String(messageId),
        boardId,
        senderName: 'Tin ghim trên Zalo',
        content: firstText(params.content, params.text, params.title, params.msg, message.content,
          data.content, data.title) || 'Tin nhắn đã ghim',
        source: 'zalo'
      };
    });
  }

  function normalizePinnedTopics(topics) {
    if (!Array.isArray(topics)) return [];
    return topics.map(topic => {
      const params = asObject(topic?.params);
      const message = asObject(params.message || params.msg);
      const messageId = params.msgId ?? params.msg_id ?? params.gMsgId ?? params.globalMsgId
        ?? params.global_msg_id ?? params.client_msg_id
        ?? message.msgId ?? message.msg_id ?? message.id;
      const boardId = topic?.id == null ? '' : String(topic.id);
      return {
        id: messageId == null ? `board:${boardId}` : String(messageId),
        boardId,
        senderName: 'Tin ghim trên Zalo',
        content: firstText(params.content, params.text, params.title, message.content,
          topic?.content, topic?.title) || 'Tin nhắn đã ghim',
        source: 'zalo'
      };
    }).filter(item => item.id !== 'board:');
  }

  function normalizePinnedFriendBoards(response) {
    const raw = Array.isArray(response) ? response :
      (Array.isArray(response?.data) ? response.data : response?.data?.items || response?.items);
    if (!Array.isArray(raw)) return [];
    return raw.map(asObject).map(topic => {
      const data = asObject(topic.data);
      const entry = Object.keys(data).length ? data : topic;
      const params = asObject(entry.params);
      const messageId = params.global_msg_id ?? params.msgId ?? params.msg_id ??
        params.globalMsgId ?? params.client_msg_id ?? params.cliMsgId;
      if (messageId == null || String(messageId) === '') return null;
      return {
        id: String(messageId),
        boardId: String(entry.id ?? topic.id ?? ''),
        senderName: firstText(params.senderName, params.sender_name) || 'Tin ghim trên Zalo',
        content: firstText(params.title, params.content, params.text) || 'Tin nhắn đã ghim',
        source: 'zalo'
      };
    }).filter(Boolean);
  }

  function mergePinnedMessages(local, remote) {
    const seen = new Set();
    return [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]
      .filter(item => {
        const id = String(item?.id ?? '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  const api = { normalizePinnedBoards, normalizePinnedTopics, normalizePinnedFriendBoards, mergePinnedMessages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.pinnedMessages = api;
})(typeof window !== 'undefined' ? window : null);
