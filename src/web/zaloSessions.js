const QRCode = require('qrcode');
const { Zalo } = require('zalo-api-final');
const { zaloFetch } = require('../main/zaloFetch');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class WebZaloSessions {
  constructor(store, createZalo = () => new Zalo({ selfListen: false, checkUpdate: false,
    logging: false, polyfill: zaloFetch })) {
    this.store = store;
    this.createZalo = createZalo;
    this.states = new Map();
    this.pending = new Map();
    this.actions = new Map();
    this.generations = new Map();
  }

  async getStatus(id) {
    await this.store.find(id);
    const current = this.states.get(id);
    if (current) return current;
    const saved = await this.store.loadSession(id);
    return { status: saved ? 'saved' : 'not_logged_in',
      message: saved ? 'Có phiên đã lưu' : 'Chưa đăng nhập', qr: '' };
  }

  setStatus(id, status, message, extra = {}) {
    this.states.set(id, { status, message, qr: '', ...extra, updatedAt: Date.now() });
  }

  async accountName(api, fallback = '') {
    try {
      const info = await api?.fetchAccountInfo?.();
      return info?.displayName || info?.zaloName || info?.name || fallback || 'Người dùng Zalo';
    } catch (_) { return fallback || 'Người dùng Zalo'; }
  }

  async startQR(id) {
    await this.store.find(id);
    const previous = (await this.getStatus(id)).status;
    if (this.pending.has(id) && ['generating_qr', 'qr_ready', 'qr_scanned'].includes(previous)) {
      return this.getStatus(id);
    }
    try { this.actions.get(id)?.abort?.(); } catch (_) {}
    const generation = (this.generations.get(id) || 0) + 1;
    this.generations.set(id, generation);
    this.setStatus(id, 'generating_qr', 'Đang tạo mã QR...');
    let credentials = null;
    let scannedName = '';
    const valid = () => this.generations.get(id) === generation;
    const zalo = this.createZalo();
    const pending = Promise.resolve().then(() => zalo.loginQR({ userAgent: DEFAULT_USER_AGENT }, async event => {
      if (!valid()) return;
      if (event.actions) this.actions.set(id, event.actions);
      if (event.type === 0) {
        const image = event.data?.image;
        const qr = image ? (image.startsWith('data:image/') ? image : `data:image/png;base64,${image}`)
          : event.data?.code ? await QRCode.toDataURL(event.data.code) : '';
        if (valid()) this.setStatus(id, 'qr_ready', 'Quét mã QR bằng Zalo trên điện thoại', { qr });
      } else if (event.type === 1) {
        this.setStatus(id, 'qr_expired', 'Mã QR đã hết hạn');
      } else if (event.type === 2) {
        scannedName = String(event.data?.display_name || '').slice(0, 80);
        this.setStatus(id, 'qr_scanned', 'Đã quét mã. Xác nhận trên điện thoại.', { name: scannedName });
      } else if (event.type === 3) {
        this.setStatus(id, 'qr_declined', 'Yêu cầu đăng nhập bị từ chối');
      } else if (event.type === 4) {
        credentials = event.data;
      }
    })).then(async api => {
      if (!valid()) return;
      if (!credentials?.imei || !Array.isArray(credentials.cookie)) throw new Error('Zalo chưa cấp phiên đăng nhập');
      const name = await this.accountName(api, scannedName);
      await this.store.saveSession(id, { ...credentials, userInfo: { name } });
      this.setStatus(id, 'connected', 'Đã đăng nhập Zalo', { name });
    }).catch(error => {
      if (valid()) this.setStatus(id, 'error', `Không thể đăng nhập: ${error.message}`);
    }).finally(() => {
      if (valid()) { this.pending.delete(id); this.actions.delete(id); }
    });
    this.pending.set(id, pending);
    return this.getStatus(id);
  }

  async whenIdle(id) { await this.pending.get(id); }

  async resumeAll() {
    await Promise.allSettled((await this.store.listAccounts()).filter(item => item.hasSession).map(async account => {
      const id = account.id;
      try {
        this.setStatus(id, 'connecting', 'Đang kết nối lại bằng phiên đã lưu');
        const session = await this.store.loadSession(id);
        const api = await this.createZalo().login({ imei: session.imei, cookie: session.cookie,
          userAgent: session.userAgent || DEFAULT_USER_AGENT });
        const name = await this.accountName(api, session.userInfo?.name);
        this.setStatus(id, 'connected', 'Đã kết nối Zalo', { name });
      } catch (error) {
        this.setStatus(id, 'expired', `Không thể dùng phiên đã lưu: ${error.message}`);
      }
    }));
  }

  async removeSession(id) {
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    try { this.actions.get(id)?.abort?.(); } catch (_) {}
    this.pending.delete(id);
    this.actions.delete(id);
    await this.store.removeSession(id);
    this.setStatus(id, 'not_logged_in', 'Đã xóa phiên lưu trên web');
  }

  async deleteAccount(id) {
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    try { this.actions.get(id)?.abort?.(); } catch (_) {}
    this.pending.delete(id);
    this.actions.delete(id);
    this.states.delete(id);
    await this.store.deleteAccount(id);
  }
}

module.exports = WebZaloSessions;
