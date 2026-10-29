const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

class FileDownloads {
  constructor(accountDir, defaultDirectory, fetcher = fetch) {
    this.accountDir = accountDir;
    this.defaultDirectory = defaultDirectory;
    this.fetcher = fetcher;
    this.indexPath = path.join(accountDir, 'file-downloads.json');
    this.pending = new Map();
    this.reservedPaths = new Set();
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch (_) {}
    this.settings = {
      mode: saved.mode === 'automatic' ? 'automatic' : 'manual',
      directory: typeof saved.directory === 'string' && saved.directory ? saved.directory : defaultDirectory
    };
    this.files = saved.files && typeof saved.files === 'object' ? saved.files : {};
  }

  persist() {
    fs.mkdirSync(this.accountDir, { recursive: true });
    const temp = `${this.indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ ...this.settings, files: this.files }), 'utf8');
    fs.renameSync(temp, this.indexPath);
  }

  getSettings() { return { ...this.settings }; }

  setSettings({ mode, directory } = {}) {
    if (mode !== undefined && !['manual', 'automatic'].includes(mode)) throw new Error('Chế độ tải tệp không hợp lệ');
    if (directory !== undefined) {
      const target = path.resolve(String(directory));
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('Thư mục lưu tệp không tồn tại');
      this.settings.directory = target;
    }
    if (mode !== undefined) this.settings.mode = mode;
    this.persist();
    return this.getSettings();
  }

  safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }

  safeName(value, url) {
    let name = String(value || '').replace(/\\/g, '/').split('/').pop()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
    if (!name) {
      try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (_) {}
      name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
    }
    return name.slice(0, 180) || 'tep_tin';
  }

  validFile(filePath, expectedSize = 0) {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0 && (!expectedSize || stat.size === expectedSize);
    } catch (_) { return false; }
  }

  lookup(items) {
    const found = {};
    let changed = false;
    for (const item of Array.isArray(items) ? items : []) {
      const rawUrl = String(item?.url || '');
      const url = this.safeUrl(rawUrl);
      if (!url) continue;
      const expectedSize = Number(item.fileSize) > 0 ? Number(item.fileSize) : 0;
      const recorded = this.files[url];
      if (recorded && this.validFile(recorded.path, expectedSize)) {
        found[rawUrl] = recorded.path;
        continue;
      }
      if (recorded) { delete this.files[url]; changed = true; }

      // Existing downloads made before the index existed can be recognized by name + exact size.
      if (!expectedSize) continue;
      const name = this.safeName(item.fileName, url);
      for (const directory of new Set([this.settings.directory, this.defaultDirectory])) {
        const candidate = path.join(directory, name);
        if (this.validFile(candidate, expectedSize)) {
          this.files[url] = { path: candidate, name };
          found[rawUrl] = candidate;
          changed = true;
          break;
        }
      }
    }
    if (changed) this.persist();
    return found;
  }

  uniquePath(directory, name) {
    const parsed = path.parse(name);
    let target = path.join(directory, name);
    for (let number = 1; fs.existsSync(target) || this.reservedPaths.has(target); number++) {
      target = path.join(directory, `${parsed.name} (${number})${parsed.ext}`);
    }
    this.reservedPaths.add(target);
    return target;
  }

  async download(fileUrl, fileName, options = {}) {
    const url = this.safeUrl(fileUrl);
    if (!url) return { success: false, error: 'Liên kết tải tệp không hợp lệ' };
    const name = this.safeName(fileName, url);
    const expectedSize = Number(options.fileSize) > 0 ? Number(options.fileSize) : 0;
    if (!options.targetPath) {
      const existing = this.lookup([{ url, fileName: name, fileSize: expectedSize }])[url];
      if (existing) return { success: true, existing: true, filePath: existing, fileName: path.basename(existing) };
      if (this.pending.has(url)) return this.pending.get(url);
    }

    const pending = this.downloadNew(url, name, options, expectedSize);
    if (!options.targetPath) this.pending.set(url, pending);
    try { return await pending; } finally { if (this.pending.get(url) === pending) this.pending.delete(url); }
  }

  async downloadNew(url, name, options, expectedSize) {
    let targetPath = '';
    let tempPath = '';
    try {
      if (options.targetPath) {
        targetPath = path.resolve(String(options.targetPath));
        if (!fs.statSync(path.dirname(targetPath)).isDirectory()) throw new Error('Thư mục lưu tệp không tồn tại');
      } else {
        const directory = this.settings.directory;
        if (!fs.statSync(directory).isDirectory()) throw new Error('Thư mục lưu tệp không tồn tại');
        targetPath = this.uniquePath(directory, name);
      }
      tempPath = `${targetPath}.${process.pid}.${Date.now()}.partial`;
      const response = await this.fetcher(url);
      if (!response.ok || !response.body) throw new Error(`Không tải được tệp (HTTP ${response.status})`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath, { flags: 'wx' }));
      if (!this.validFile(tempPath, expectedSize)) throw new Error('Tệp tải về rỗng hoặc không đúng kích thước');
      fs.renameSync(tempPath, targetPath);
      this.files[url] = { path: targetPath, name: path.basename(targetPath) };
      this.persist();
      return { success: true, filePath: targetPath, fileName: path.basename(targetPath) };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      if (tempPath) { try { fs.unlinkSync(tempPath); } catch (_) {} }
      if (targetPath) this.reservedPaths.delete(targetPath);
    }
  }

  async onMessage(message, isOld = false) {
    if (this.settings.mode !== 'automatic' || isOld || message?.isSelf ||
      !message?.fileUrl || !message?.isFile) return null;
    return this.download(message.fileUrl, message.fileName, { fileSize: message.fileSize });
  }
}

module.exports = FileDownloads;
