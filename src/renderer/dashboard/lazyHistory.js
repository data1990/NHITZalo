function getVirtualRange(total, scrollTop, viewportHeight, rowHeight = 70, overscan = 8) {
  const count = Math.max(0, Math.trunc(total));
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight));
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + Math.max(rowHeight, viewportHeight)) / rowHeight) + overscan);
  return { start, end, top: start * rowHeight, bottom: (count - end) * rowHeight };
}

function retainActiveThreadMessages(messages, activeThreadId) {
  const heads = new Map();
  const selected = [];
  const active = String(activeThreadId || '');
  for (const message of messages) {
    if (!message?.threadId) continue;
    const threadId = String(message.threadId);
    const key = `${message.isGroup ? 'g' : 'u'}:${threadId}`;
    const head = heads.get(key);
    if (!head || Number(message.timestamp) > Number(head.timestamp)) heads.set(key, message);
    if (threadId === active) selected.push(message);
  }
  const merged = new Map();
  for (const message of [...heads.values(), ...selected]) {
    merged.set(`${message.threadId}:${message.id || message.cliMsgId || message.timestamp}`, message);
  }
  return [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function mergeIncomingHistory(current, incoming, activeThreadId) {
  const unique = new Map();
  for (const message of [...current, ...incoming]) {
    if (!message?.threadId) continue;
    unique.set(`${message.threadId}:${message.id || message.cliMsgId || message.timestamp}`, message);
  }
  return retainActiveThreadMessages([...unique.values()], activeThreadId);
}

const LazyHistory = { getVirtualRange, retainActiveThreadMessages, mergeIncomingHistory };
if (typeof module !== 'undefined' && module.exports) module.exports = LazyHistory;
if (typeof window !== 'undefined') window.LazyHistory = LazyHistory;
