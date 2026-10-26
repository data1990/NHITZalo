(function(root) {
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        ? url.href : '';
    } catch (_) { return ''; }
  }

  function getMessageUrl(message) {
    const direct = safeUrl(message?.linkUrl);
    if (direct) return direct;
    const raw = String(message?.content || '').match(/https?:\/\/[^\s<>"']+/i)?.[0];
    return safeUrl(raw?.replace(/[.,;!?)]*$/, ''));
  }

  function renderCard(message, preview = {}) {
    const url = getMessageUrl(message);
    if (!url) return '';
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const title = String(preview.title || message.linkPreview?.title || '').trim();
    const description = String(preview.description || message.linkPreview?.description || '').trim();
    const image = safeUrl(preview.image || message.linkPreview?.image);
    const originalText = String(message.content || '').trim();
    const prefix = !message.isLink && !message.linkPreview && originalText !== url && originalText.includes(url)
      ? `<div class="chat-link-message">${escapeHtml(originalText)}</div>` : '';
    return `<div class="chat-link-wrapper">${prefix}
      <a class="chat-link-card" href="${escapeHtml(url)}" data-link-url="${escapeHtml(url)}"
        target="_blank" rel="noopener noreferrer" aria-label="Mở liên kết ${escapeHtml(title || domain)}">
        <span class="chat-link-url">${escapeHtml(url)}</span>
        ${image ? `<img class="chat-link-preview-image" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        ${title ? `<strong class="chat-link-title">${escapeHtml(title)}</strong>` : ''}
        ${description ? `<span class="chat-link-description">${escapeHtml(description)}</span>` : ''}
        <span class="chat-link-domain">${escapeHtml(domain)}</span>
      </a></div>`;
  }

  const api = { getMessageUrl, renderCard };
  if (typeof module !== 'undefined') module.exports = api;
  if (root) root.LinkPreview = api;
})(typeof window !== 'undefined' ? window : null);
