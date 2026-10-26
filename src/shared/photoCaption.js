(function(root) {
  function cleanCaption(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text || /^\[(?:Hình ảnh|Tin nhắn|Ảnh động)\]$/i.test(text) ||
      /^https?:\/\/\S+$/i.test(text)) return '';
    return text;
  }

  function paramsFrom(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
  }

  function extractPhotoCaption(data) {
    const content = data?.content;
    const media = content && typeof content === 'object' ? content : {};
    const params = paramsFrom(media.params);
    const candidates = [media.caption, media.title, media.description,
      params.caption, params.title, params.description,
      data?.caption, data?.title, typeof content === 'string' ? content : ''];
    return candidates.map(cleanCaption).find(Boolean) || '';
  }

  function getPhotoCaption(message) {
    if (!message?.isPhoto) return '';
    return cleanCaption(message.photoCaption) || cleanCaption(message.caption) ||
      cleanCaption(message.content);
  }

  const api = { extractPhotoCaption, getPhotoCaption };
  if (typeof module !== 'undefined') module.exports = api;
  if (root) root.PhotoCaption = api;
})(typeof window !== 'undefined' ? window : null);
