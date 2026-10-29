(function (root) {
  function getClipboardImageFile(data) {
    for (const item of Array.from(data?.items || [])) {
      if (!String(item.type || '').startsWith('image/')) continue;
      const file = item.getAsFile?.();
      if (file) return file;
    }
    return Array.from(data?.files || []).find(file => String(file.type || '').startsWith('image/')) || null;
  }

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh từ clipboard'));
      reader.readAsDataURL(file);
    });
  }

  const api = { getClipboardImageFile, readImageAsDataUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ClipboardImage = api;
})(typeof window !== 'undefined' ? window : null);
