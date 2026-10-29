(function (root) {
  const validId = value => /^\d{7,25}$/.test(String(value || ''));

  function parseMentionMetadata(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (_) { return []; }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && validId(item.uid || item.userId) &&
      Number.isInteger(Number(item.pos)) && Number(item.pos) >= 0 &&
      Number.isInteger(Number(item.len)) && Number(item.len) > 0)
      .map(item => ({ pos: Number(item.pos), len: Number(item.len),
        uid: String(item.uid || item.userId) }));
  }

  function getMentionSegments(message, candidates = []) {
    const text = String(message?.content || '');
    if (!message?.isGroup || !text.includes('@')) return [{ text }];
    const ranges = [];
    for (const mention of parseMentionMetadata(message.mentions)) {
      let start = mention.pos;
      let end = start + mention.len;
      if (text[start] !== '@' && text[start - 1] === '@') start -= 1;
      if (text[start] !== '@' || end > text.length || end <= start) continue;
      ranges.push({ start, end, uid: mention.uid });
    }

    const names = new Map();
    for (const candidate of candidates) {
      const name = String(candidate?.name || '').trim();
      const uid = String(candidate?.id || candidate?.userId || '');
      if (!name || !validId(uid)) continue;
      const key = name.toLocaleLowerCase('vi');
      if (!names.has(key)) names.set(key, { name, ids: new Set() });
      names.get(key).ids.add(uid);
    }
    const uniqueNames = [...names.values()].filter(item => item.ids.size === 1)
      .sort((a, b) => b.name.length - a.name.length);
    for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
      if (ranges.some(range => at >= range.start && at < range.end)) continue;
      const remaining = text.slice(at + 1).toLocaleLowerCase('vi');
      const match = uniqueNames.find(item => {
        if (!remaining.startsWith(item.name.toLocaleLowerCase('vi'))) return false;
        const next = text[at + 1 + item.name.length];
        return !next || /[\s,.;!?):\]]/.test(next);
      });
      if (match) ranges.push({ start: at, end: at + 1 + match.name.length,
        uid: [...match.ids][0] });
    }

    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const segments = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor) continue;
      if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start) });
      segments.push({ text: text.slice(range.start, range.end), uid: range.uid });
      cursor = range.end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments.length ? segments : [{ text }];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function renderMentionHtml(message, candidates = []) {
    return getMentionSegments(message, candidates).map(segment => {
      if (!segment.uid) return escapeHtml(segment.text);
      const name = segment.text.slice(1);
      return `<button type="button" class="chat-mention" data-mention-uid="${segment.uid}" data-mention-name="${escapeHtml(name)}" title="Nhắn tin với ${escapeHtml(name)}">${escapeHtml(segment.text)}</button>`;
    }).join('');
  }

  const api = { parseMentionMetadata, getMentionSegments, renderMentionHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Mentions = api;
})(typeof window !== 'undefined' ? window : null);
