(function (root) {
  const STORAGE_KEY = 'nhitzalo.closedBubbleThreads';

  function createBubbleThreadVisibility(storage) {
    let saved = [];
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(parsed)) saved = parsed.filter(id => typeof id === 'string');
    } catch (_) {
      // A corrupt or unavailable local store must not hide any conversations.
    }
    const closed = new Set(saved);
    const persist = () => {
      try { storage?.setItem(STORAGE_KEY, JSON.stringify([...closed])); } catch (_) {}
    };

    return {
      close(threadId) {
        closed.add(String(threadId));
        persist();
      },
      isClosed(threadId) { return closed.has(String(threadId)); },
      visible(threads) { return threads.filter(thread => !closed.has(String(thread.threadId))); },
      reopenForMessage(threadId, message) {
        if (message?.isOld !== false || message.isSelf || !closed.delete(String(threadId))) return false;
        persist();
        return true;
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBubbleThreadVisibility };
  }
  root.createBubbleThreadVisibility = createBubbleThreadVisibility;
})(typeof window !== 'undefined' ? window : globalThis);
