// Tự động kiểm tra và áp dụng bản vá cookie cho zalo-api-final nếu cần
try {
  require('../../scripts/patch-zalo.js');
} catch (e) {
  console.warn('Lỗi kiểm tra patch-zalo:', e.message);
}

const { Zalo } = require('zalo-api-final');
const { zaloFetch } = require('./zaloFetch');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');
const QRCode = require('qrcode');
const MessageStore = require('./messageStore');
const { importDecryptedBackup, decryptBackupKey, downloadBackup, decodeBackupWithZalo, parseBackupMediaWithZalo } = require('./phoneBackupImport');
const { requestNoisedIds, fetchThreadProfiles } = require('./threadIdentity');
const { extractPhotoCaption } = require('../shared/photoCaption');
const { describeCallMessage } = require('../shared/callMessage');

// Số lượng tin nhắn gần nhất giữ trong bộ nhớ; SQLite lưu toàn bộ lịch sử.
const MAX_LOCAL_MESSAGES = 5000;

class ZaloManager {
  constructor(onStatusChange, onNewMessage, onSyncStatus, onMessageUndo, onReactionUpdate, onPhotoCaptionUpdate, accountDataDir) {
    this.zalo = null;
    this.api = null;
    this.onStatusChange = onStatusChange || (() => {});
    this.onNewMessage = onNewMessage || (() => {});
    this.onSyncStatus = onSyncStatus || (() => {});
    this.onMessageUndo = onMessageUndo || (() => {});
    this.onReactionUpdate = onReactionUpdate || (() => {});
    this.onPhotoCaptionUpdate = onPhotoCaptionUpdate || (() => {});
    const userDataPath = accountDataDir || ((app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : (process.env.APPDATA ? path.join(process.env.APPDATA, 'nhitzalo') : path.join(__dirname, '../../data')));
    fs.mkdirSync(userDataPath, { recursive: true });
    this.accountDataDir = userDataPath;
    this.sessionPath = path.join(userDataPath, 'zalo_session.json');
    this.messagesPath = path.join(userDataPath, 'zalo_messages.json');
    this.groupsPath = path.join(userDataPath, 'zalo_groups.json');
    this.friendsPath = path.join(userDataPath, 'zalo_friends.json');
    this.pinnedPath = path.join(userDataPath, 'zalo_pinned.json');
    this.mutedPath = path.join(userDataPath, 'zalo_muted.json');
    this.readPath = path.join(userDataPath, 'zalo_read.json');
    this.messageStore = new MessageStore(path.join(userDataPath, 'zalo_messages.sqlite'), this.messagesPath);
    this.pendingHistoryMessages = new Map();
    this.currentUser = null;
    this.isConnecting = false;
    this.messagesHistory = this.loadMessagesHistory();
    this.pinnedThreads = this.loadPinnedThreads();
    this.mutedThreads = this.loadMutedThreads();
    this.readThreads = this.loadReadThreads();
    this.cachedFriends = this.loadCachedFriends();
    this.cachedFriendsTime = fs.existsSync(this.friendsPath) ? Date.now() : 0;
    this.cachedGroups = this.loadCachedGroups();
    this.cachedGroupsTime = fs.existsSync(this.groupsPath) ? Date.now() : 0;
    this.isSyncing = false;
    this.phoneSyncState = {
      active: false,
      isWaiting: false,
      isPreparing: false,
      packetsReceived: 0,
      lastPacketTime: 0,
      isFinished: false
    };
    this.syncDebounceTimer = null;
    this.listener = null;
    this.activeScanPromise = null;
    this.bulkHistoryMode = false;
    this.scanDelayMs = 150;
    this.lastOldScanTime = 0;
    this.recentCatchupDelayMs = 800;
    this.recentCatchupTimer = null;
    this.recentCatchupScheduledTimer = null;
    this.recentCatchupPromise = null;
    this.recentCatchupPageLimit = 40;
    this.recentCatchupCursors = { 0: null, 1: null };
    this.startupQuickSyncPending = false;
    this.startupQuickSyncPromise = null;
  }

  // Tải danh sách thời gian đã đọc các hội thoại
  loadReadThreads() {
    try {
      if (fs.existsSync(this.readPath)) {
        const raw = fs.readFileSync(this.readPath, 'utf8');
        return JSON.parse(raw) || {};
      }
    } catch (e) {
      console.warn('Lỗi loadReadThreads:', e.message);
    }
    return {};
  }

  // Lưu danh sách thời gian đã đọc vào đĩa
  saveReadThreads() {
    try {
      fs.writeFileSync(this.readPath, JSON.stringify(this.readThreads || {}, null, 2), 'utf8');
    } catch (e) {
      console.warn('Lỗi saveReadThreads:', e.message);
    }
  }

  // Đánh dấu hội thoại đã đọc (lưu timestamp mới nhất)
  markThreadAsRead(threadId, timestamp = Date.now()) {
    if (!threadId) return null;
    const sId = String(threadId);
    const cleanId = sId.replace(/^g_/, '');
    if (!this.readThreads) this.readThreads = {};
    this.readThreads[sId] = timestamp;
    this.readThreads[cleanId] = timestamp;
    this.readThreads['g_' + cleanId] = timestamp;
    this.saveReadThreads();
    return { threadId: sId, cleanId, timestamp };
  }

  // Lấy toàn bộ mốc thời gian đã đọc
  getReadThreads() {
    return this.readThreads || {};
  }

  // Tải danh sách các hội thoại được ghim
  loadPinnedThreads() {
    try {
      if (fs.existsSync(this.pinnedPath)) {
        const raw = fs.readFileSync(this.pinnedPath, 'utf8');
        const list = JSON.parse(raw);
        return new Set(Array.isArray(list) ? list : []);
      }
    } catch (e) {}
    return new Set();
  }

  // Lưu danh sách hội thoại ghim
  savePinnedThreads() {
    try {
      fs.writeFileSync(this.pinnedPath, JSON.stringify(Array.from(this.pinnedThreads), null, 2), 'utf8');
    } catch (e) {}
  }

  // Lấy mảng ID các hội thoại được ghim
  getPinnedThreads() {
    return Array.from(this.pinnedThreads || []);
  }

  async fetchPinnedThreads() {
    if (!this.api?.getPinConversations) return this.getPinnedThreads();
    if (Date.now() - (this.lastPinnedFetchTime || 0) < 2 * 60_000) return this.getPinnedThreads();
    try {
      const response = await this.api.getPinConversations();
      const conversations = response?.conversations || response?.data?.conversations;
      if (!Array.isArray(conversations)) return this.getPinnedThreads();
      const normalized = conversations
        .filter(value => typeof value === 'string' && /^[ug]_?\d+$/.test(value))
        .map(value => value.slice(1).replace(/^_/, ''));
      this.pinnedThreads = new Set(normalized);
      this.lastPinnedFetchTime = Date.now();
      this.savePinnedThreads();
    } catch (error) {
      console.warn('Không thể tải hội thoại ghim từ Zalo:', error.message);
    }
    return this.getPinnedThreads();
  }

  // Tải danh sách hội thoại tắt thông báo (Muted)
  loadMutedThreads() {
    try {
      if (fs.existsSync(this.mutedPath)) {
        const raw = fs.readFileSync(this.mutedPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Lỗi loadMutedThreads:', e.message);
    }
    return {};
  }

  // Lưu danh sách hội thoại tắt thông báo
  saveMutedThreads() {
    try {
      fs.writeFileSync(this.mutedPath, JSON.stringify(this.mutedThreads || {}, null, 2), 'utf8');
    } catch (e) {
      console.warn('Lỗi saveMutedThreads:', e.message);
    }
  }

  // Kiểm tra xem một hội thoại (nhóm hoặc user) có đang bị tắt thông báo không
  isThreadMuted(threadId) {
    if (!threadId || !this.mutedThreads) return false;
    const strId = String(threadId);
    const entry = this.mutedThreads[strId] || 
                  this.mutedThreads[strId.replace(/^g_/, '')] || 
                  this.mutedThreads['g_' + strId];
    if (!entry) return false;

    // duration = -1: tắt thông báo vĩnh viễn
    if (entry.duration === -1) return true;

    // duration > 0: tắt thông báo có thời hạn
    if (entry.duration > 0 && entry.startTime) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec < (entry.startTime + entry.duration)) {
        return true;
      }
      // Đã hết hạn -> xóa khỏi danh sách mute
      delete this.mutedThreads[strId];
      this.saveMutedThreads();
      return false;
    }
    return false;
  }

  // Lấy danh sách ID các hội thoại đang bị tắt thông báo (đã lọc hết hạn)
  getMutedThreads() {
    const activeMuted = {};
    if (!this.mutedThreads) return activeMuted;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [id, entry] of Object.entries(this.mutedThreads)) {
      if (entry.duration === -1 || (entry.duration > 0 && entry.startTime && nowSec < (entry.startTime + entry.duration))) {
        activeMuted[id] = entry;
      }
    }
    return activeMuted;
  }

  // Nạp danh sách tắt thông báo từ Zalo Server chính chủ
  async fetchMuteList() {
    if (!this.api || typeof this.api.getMute !== 'function') return this.getMutedThreads();
    try {
      console.log('Đang đồng bộ danh sách hội thoại tắt thông báo từ Zalo API...');
      const muteData = await this.api.getMute();
      if (muteData) {
        const newMuted = {};
        const chatEntries = Array.isArray(muteData.chatEntries) ? muteData.chatEntries : [];
        const groupChatEntries = Array.isArray(muteData.groupChatEntries) ? muteData.groupChatEntries : [];

        chatEntries.forEach(item => {
          if (item && item.id) {
            newMuted[String(item.id)] = {
              id: String(item.id),
              duration: item.duration ?? -1,
              startTime: item.startTime || Math.floor(Date.now() / 1000),
              muteMode: item.muteMode ?? 0,
              isGroup: false,
              advanced: item.advanced || null
            };
          }
        });

        groupChatEntries.forEach(item => {
          if (item && item.id) {
            newMuted[String(item.id)] = {
              id: String(item.id),
              duration: item.duration ?? -1,
              startTime: item.startTime || Math.floor(Date.now() / 1000),
              muteMode: item.muteMode ?? 0,
              isGroup: true,
              advanced: item.advanced || null
            };
          }
        });

        this.mutedThreads = newMuted;
        this.saveMutedThreads();
        console.log(`Đã cập nhật ${Object.keys(newMuted).length} hội thoại tắt thông báo từ Zalo.`);
        return newMuted;
      }
    } catch (err) {
      console.warn('Lỗi fetchMuteList từ Zalo API:', err.message);
    }
    return this.getMutedThreads();
  }

  // Bật hoặc tắt thông báo cho 1 hội thoại (đồng bộ lên Zalo Server)
  async setThreadMute(threadId, isMuted, isGroup = false, duration = -1) {
    if (!threadId) return { success: false, error: 'Thiếu threadId' };
    const strId = String(threadId);

    // Chỉ ghi trạng thái cục bộ sau khi máy chủ xác nhận.
    if (this.api && typeof this.api.setMute === 'function') {
      try {
        const { MuteAction, MuteDuration } = require('zalo-api-final');
        const action = isMuted ? (MuteAction?.MUTE || 1) : (MuteAction?.UNMUTE || 3);
        const dur = duration === -1 ? (MuteDuration?.FOREVER || -1) : duration;
        const threadType = isGroup ? 1 : 0;
        await this.api.setMute({ action, duration: dur }, strId, threadType);
      } catch (err) {
        console.warn('Lỗi đồng bộ setMute lên Zalo:', err.message);
        return { success: false, error: err.message, threadId: strId };
      }
    }

    if (!this.mutedThreads) this.mutedThreads = {};
    if (isMuted) {
      this.mutedThreads[strId] = {
        id: strId,
        duration,
        startTime: Math.floor(Date.now() / 1000),
        muteMode: 0,
        isGroup
      };
    } else {
      delete this.mutedThreads[strId];
      delete this.mutedThreads[strId.replace(/^g_/, '')];
      delete this.mutedThreads['g_' + strId];
    }
    this.saveMutedThreads();

    return { success: true, isMuted: isMuted, threadId: strId };
  }

  // Lấy đường dẫn lưu session
  getSessionPath() {
    return this.sessionPath;
  }

  // Kiểm tra xem đã có session lưu từ trước chưa
  hasSavedSession() {
    return fs.existsSync(this.sessionPath);
  }

  // Tải thông tin session
  loadSession() {
    try {
      if (this.hasSavedSession()) {
        const raw = fs.readFileSync(this.sessionPath, 'utf8');
        const saved = JSON.parse(raw);
        if (saved && saved.version === 2 && saved.ciphertext) {
          if (!safeStorage?.isEncryptionAvailable()) return null;
          return JSON.parse(safeStorage.decryptString(Buffer.from(saved.ciphertext, 'base64')));
        }
        if (saved?.imei && saved?.cookie) this.saveSession(saved);
        return saved;
      }
    } catch (err) {
      console.error('Lỗi khi đọc session:', err);
    }
    return null;
  }

  // Lưu session
  saveSession(data) {
    try {
      if (!safeStorage?.isEncryptionAvailable()) {
        console.warn('Không thể lưu phiên: mã hóa hệ điều hành chưa khả dụng');
        return false;
      }
      const ciphertext = safeStorage.encryptString(JSON.stringify(data)).toString('base64');
      fs.writeFileSync(this.sessionPath, JSON.stringify({ version: 2, ciphertext }), 'utf8');
      return true;
    } catch (err) {
      console.error('Lỗi khi lưu session:', err);
      return false;
    }
  }

  // Xóa session (Đăng xuất)
  clearSession() {
    try {
      if (this.recentCatchupTimer) clearInterval(this.recentCatchupTimer);
      if (this.recentCatchupScheduledTimer) clearTimeout(this.recentCatchupScheduledTimer);
      this.recentCatchupTimer = null;
      this.recentCatchupScheduledTimer = null;
      this.recentCatchupCursors = { 0: null, 1: null };
      if (this.hasSavedSession()) {
        fs.unlinkSync(this.sessionPath);
      }
      if (this.listener) {
        if (typeof this.listener.removeAllListeners === 'function') {
          this.listener.removeAllListeners();
        }
        try {
          this.listener.stop();
        } catch (e) {}
        this.listener = null;
      }
      this.api = null;
      this.currentUser = null;
      this.activeScanPromise = null;
      this.onStatusChange({
        status: 'disconnected',
        message: 'Đã đăng xuất tài khoản'
      });
      return true;
    } catch (err) {
      console.error('Lỗi khi xóa session:', err);
      return false;
    }
  }

  // Tải lịch sử tin nhắn đã lưu từ ổ đĩa (chỉ giữ tin nhắn thật, loại bỏ triệt để fake conv)
  loadMessagesHistory() {
    try {
      return this.messageStore.getRecent(MAX_LOCAL_MESSAGES);
    } catch (e) {
      console.warn('Không thể đọc lịch sử tin nhắn:', e.message);
    }
    return [];
  }

  // Đồng bộ phần lịch sử đang giữ trong bộ nhớ vào SQLite.
  flushMessagesHistory() {
    if (this.saveMessagesDebounceTimer) clearTimeout(this.saveMessagesDebounceTimer);
    this.saveMessagesDebounceTimer = null;
    const toSave = [
      ...this.pendingHistoryMessages.values(),
      ...(this.messagesHistory || []).filter(m => !m.isConversation && !(m.id && String(m.id).startsWith('conv_')))
    ];
    this.messageStore.putMany(toSave);
    this.pendingHistoryMessages.clear();
  }

  saveMessagesHistory() {
    try { this.flushMessagesHistory(); }
    catch (e) { console.warn('Lỗi khi lưu lịch sử tin nhắn:', e.message); }
  }

  // Lên lịch lưu đĩa thông minh (tránh nghẽn ghi đĩa đồng bộ khi nhận loạt tin nhắn cũ)
  scheduleSaveMessages() {
    if (this.saveMessagesDebounceTimer) clearTimeout(this.saveMessagesDebounceTimer);
    this.saveMessagesDebounceTimer = setTimeout(() => {
      this.saveMessagesHistory();
    }, 400);
  }

  // Thêm tin nhắn vào bộ nhớ lịch sử và lưu đĩa
  addMessageToHistory(formattedMsg, immediateSave = false) {
    if (!formattedMsg || !formattedMsg.id) return;
    // Tuyệt đối không thêm item fake conversation
    if (formattedMsg.isConversation || (formattedMsg.id && formattedMsg.id.startsWith('conv_'))) return;
    if (!this.messagesHistory) this.messagesHistory = [];
    
    // Kiểm tra xem tin nhắn đã có trong lịch sử (theo id hoặc cliMsgId)
    const existingIndex = this.messagesHistory.findIndex(m =>
      String(m.threadId) === String(formattedMsg.threadId) && (
        (m.id && String(m.id) === String(formattedMsg.id)) ||
        (formattedMsg.cliMsgId && m.cliMsgId && String(m.cliMsgId) === String(formattedMsg.cliMsgId))
      )
    );

    let toPersist = formattedMsg;
    if (existingIndex !== -1) {
      // Nếu tin nhắn mới là tin thu hồi, cập nhật đè tin nhắn cũ trong lịch sử
      if (formattedMsg.isUndo || formattedMsg.isRevoked) {
        const target = this.messagesHistory[existingIndex];
        toPersist = target;
        target.isUndo = true;
        target.isRevoked = true;
        target.isRecalled = true;
        target.content = 'Tin nhắn đã được thu hồi';
        target.isPhoto = false;
        target.photoUrl = '';
        target.thumbUrl = '';
        target.isVideo = false;
        target.videoUrl = '';
        target.isSticker = false;
        target.stickerUrl = '';
        target.isFile = false;
        target.isLink = false;
      }
      else return;
    } else {
      this.messagesHistory.unshift(formattedMsg);
      // Sắp xếp giảm dần theo thời gian
      this.messagesHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    this.pendingHistoryMessages.set(`${toPersist.threadId}\0${toPersist.id}`, toPersist);

    // Giới hạn bộ nhớ ở 5.000 tin; dữ liệu cũ vẫn nằm trong SQLite.
    if (this.messagesHistory.length > MAX_LOCAL_MESSAGES) {
      this.messagesHistory = this.messagesHistory.slice(0, MAX_LOCAL_MESSAGES);
    }

    if (immediateSave) {
      this.saveMessagesHistory();
    } else {
      this.scheduleSaveMessages();
    }
  }

  // Lấy toàn bộ lịch sử tin nhắn
  getHistoryMessages() {
    const recent = (this.messagesHistory || []).map(message => this.messageStore.hydrate({ ...message }));
    const known = new Set(recent.map(message => `${message.threadId}:${message.id}`));
    const oldestThreadHeads = this.messageStore.getLatestPerThread()
      .filter(message => !known.has(`${message.threadId}:${message.id}`));
    return recent.concat(oldestThreadHeads);
  }

  getConversationHeads() {
    const heads = new Map();
    for (const message of this.messageStore.getLatestPerThread()) {
      const key = `${message.isGroup ? 'g' : 'u'}:${message.threadId}`;
      const current = heads.get(key);
      if (!current || Number(message.timestamp) > Number(current.timestamp)) heads.set(key, message);
    }
    for (const pending of this.pendingHistoryMessages.values()) {
      const message = this.messageStore.hydrate({ ...pending });
      const key = `${message.isGroup ? 'g' : 'u'}:${message.threadId}`;
      const current = heads.get(key);
      if (!current || Number(message.timestamp) >= Number(current.timestamp)) heads.set(key, message);
    }
    return [...heads.values()].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  }

  getBubbleStartupMessages() {
    return this.messageStore.getRecent(250);
  }

  getThreadHistory(threadId, limit = 50, offset = 0) {
    if (!threadId) return [];
    return this.messageStore.getThread(threadId, limit, offset);
  }

  searchHistoryMessages(query, limit = 50, offset = 0) {
    return this.messageStore.search(query, limit, offset);
  }

  // Xóa toàn bộ lịch sử tin nhắn
  clearHistoryMessages() {
    this.messagesHistory = [];
    this.pendingHistoryMessages.clear();
    if (this.saveMessagesDebounceTimer) clearTimeout(this.saveMessagesDebounceTimer);
    this.saveMessagesDebounceTimer = null;
    try {
      this.messageStore.clear();
      if (fs.existsSync(this.messagesPath)) {
        fs.unlinkSync(this.messagesPath);
      }
    } catch (e) {
      console.warn('Lỗi khi xóa file lịch sử tin nhắn:', e.message);
    }
    return true;
  }

  // Tải danh sách bạn bè đã cache từ ổ đĩa
  loadCachedFriends() {
    try {
      if (fs.existsSync(this.friendsPath)) {
        const raw = fs.readFileSync(this.friendsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc cache bạn bè cũ:', e.message);
    }
    return [];
  }

  // Lưu danh sách bạn bè vào ổ đĩa
  saveCachedFriends() {
    try {
      fs.writeFileSync(this.friendsPath, JSON.stringify(this.cachedFriends || [], null, 2), 'utf8');
    } catch (e) {
      console.warn('Lỗi lưu cache bạn bè:', e.message);
    }
  }

  // Lấy danh sách toàn bộ bạn bè
  getFriendsList() {
    return Array.isArray(this.cachedFriends) ? this.cachedFriends : [];
  }

  // Nạp danh sách bạn bè từ máy chủ Zalo
  async fetchFriendsList() {
    if (!this.api || typeof this.api.getAllFriends !== 'function') return this.getFriendsList();
    try {
      console.log('Đang nạp danh sách bạn bè Zalo...');
      const friends = await this.api.getAllFriends();
      if (Array.isArray(friends) && friends.length > 0) {
        this.cachedFriends = friends.map(f => ({
          userId: String(f.userId || ''),
          displayName: f.displayName || f.zaloName || 'Bạn bè Zalo',
          zaloName: f.zaloName || '',
          avatar: f.avatar || '',
          phoneNumber: f.phoneNumber || '',
          gender: f.gender
        }));
        this.cachedFriendsTime = Date.now();
        this.saveCachedFriends();
        console.log(`Đã nạp và lưu thành công ${this.cachedFriends.length} bạn bè Zalo.`);
      }
    } catch (err) {
      console.warn('Lỗi khi fetchFriendsList:', err.message);
    }
    return this.getFriendsList();
  }

  // Tải thông tin nhóm Zalo đã cache từ ổ đĩa
  loadCachedGroups() {
    try {
      if (fs.existsSync(this.groupsPath)) {
        const raw = fs.readFileSync(this.groupsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc cache nhóm cũ:', e.message);
    }
    return {};
  }

  // Lưu thông tin nhóm Zalo vào ổ đĩa
  saveCachedGroups() {
    try {
      fs.writeFileSync(this.groupsPath, JSON.stringify(this.cachedGroups || {}, null, 2), 'utf8');
    } catch (e) {
      console.warn('Lỗi lưu cache nhóm:', e.message);
    }
  }

  // Lấy danh sách toàn bộ các nhóm Zalo dưới dạng mảng
  getGroupsList() {
    if (!this.cachedGroups) return [];
    return Object.values(this.cachedGroups).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  }

  // Nạp danh sách và thông tin chi tiết toàn bộ các nhóm Zalo từ máy chủ Zalo
  async fetchGroupsList() {
    if (!this.api) return this.getGroupsList();
    try {
      const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
      const utils = require(utilsPath);
      const ctx = this.api.getContext();

      console.log('Đang kiểm tra danh sách nhóm Zalo...');
      const groupsResult = await this.api.getAllGroups();
      const gridVerMap = groupsResult?.gridVerMap || {};
      const groupIds = Object.keys(gridVerMap);
      console.log(`Tìm thấy ${groupIds.length} nhóm Zalo.`);

      if (groupIds.length === 0) {
        return [];
      }

      if (!this.cachedGroups) this.cachedGroups = {};

      // Lấy chi tiết các nhóm (tên, avatar, số thành viên) theo từng batch 25 nhóm
      const batchSize = 25;
      const groupBase = this.api.zpwServiceMap.group[0];
      const serviceURL = utils.makeURL(ctx, `${groupBase}/api/group/getmg-v2`);

      for (let i = 0; i < groupIds.length; i += batchSize) {
        const batchIds = groupIds.slice(i, i + batchSize);
        const verMap = {};
        batchIds.forEach(id => { verMap[id] = 0; });

        try {
          const params = { gridVerMap: JSON.stringify(verMap) };
          const enc = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
          const getURL = utils.makeURL(ctx, serviceURL, { params: enc });
          const response = await utils.request(ctx, getURL, { method: 'GET' });
          const result = await response.json();

          if (result && result.data) {
            const decodedStr = utils.decodeAES(ctx.secretKey, result.data);
            const parsed = JSON.parse(decodedStr);
            if (parsed && parsed.data && parsed.data.gridInfoMap) {
              const infoMap = parsed.data.gridInfoMap;
              for (const [gId, gInfo] of Object.entries(infoMap)) {
                this.cachedGroups[gId] = {
                  groupId: gId,
                  name: gInfo.name || 'Nhóm Zalo',
                  avatar: gInfo.avt || gInfo.fullAvt || '',
                  totalMember: gInfo.totalMember || (gInfo.memVerList ? gInfo.memVerList.length : 0),
                  creatorId: gInfo.creatorId || '',
                  desc: gInfo.desc || '',
                  type: gInfo.type || 1,
                  isGroup: true,
                  updatedAt: Date.now()
                };
              }
            }
          }
        } catch (batchErr) {
          console.warn(`Lỗi nạp batch nhóm (${i} - ${i + batchSize}):`, batchErr.message);
        }

        // Tạm nghỉ 150ms tránh rate limit
        await new Promise(r => setTimeout(r, 150));
      }

      this.cachedGroupsTime = Date.now();
      this.saveCachedGroups();
      console.log(`Đã nạp và lưu thành công ${Object.keys(this.cachedGroups).length} nhóm Zalo.`);
    } catch (err) {
      console.error('Lỗi khi fetchGroupsList:', err.message);
    }
    return this.getGroupsList();
  }

  // Đăng nhập tự động bằng session đã lưu (nếu có)
  // Đăng nhập tự động bằng session đã lưu (có cơ chế thử lại nếu gặp lỗi mạng tạm thời)
  async tryAutoLogin(retries = 3) {
    const session = this.loadSession();
    if (!session || !session.imei || !session.cookie) {
      return false;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.onStatusChange({
          status: 'connecting',
          message: attempt > 1
            ? `Đang thử kết nối lại (lần ${attempt}/${retries})...`
            : 'Đang kết nối lại bằng phiên đã lưu...'
        });

        this.zalo = new Zalo({
          selfListen: true,
          checkUpdate: false,
          logging: false,
          polyfill: zaloFetch
        });

        this.api = await this.zalo.login({
          imei: session.imei,
          cookie: session.cookie,
          userAgent: session.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const myUid = (this.api?.getContext ? String(this.api.getContext()?.uid || '') : '');
        this.currentUser = session.userInfo || { name: 'Người dùng Zalo', avatar: '', userId: myUid };
        if (!this.currentUser.userId && myUid) {
          this.currentUser.userId = myUid;
        }

        // Luôn làm mới thông tin tài khoản thật từ Zalo API
        try {
          if (this.api && this.api.fetchAccountInfo) {
            const accInfo = await this.api.fetchAccountInfo();
            if (accInfo) {
              const realName = accInfo.displayName || accInfo.zaloName || accInfo.name || this.currentUser.name;
              const realAvatar = accInfo.avatar || accInfo.cover || this.currentUser.avatar || '';
              this.currentUser = {
                name: realName,
                avatar: realAvatar,
                userId: String(accInfo.userId || myUid || '')
              };
              this.saveSession({
                ...session,
                userInfo: this.currentUser
              });
            }
          }
        } catch (e) {
          console.warn('Không thể fetchAccountInfo khi auto login:', e.message);
        }

        this.initListener();

        this.onStatusChange({
          status: 'connecting',
          message: 'Đang xác thực luồng tin nhắn Zalo',
          user: this.currentUser
        });

        // Tự động nạp danh sách và chi tiết bạn bè & nhóm Zalo ngầm
        Promise.allSettled([this.fetchFriendsList(), this.fetchGroupsList()])
          .then(() => this.resolveBackupThreadIdentities())
          .catch(e => console.warn('Lỗi khôi phục tên hội thoại:', e.message));
        this.fetchMuteList().catch(e => console.warn('Lỗi auto fetch mute list:', e.message));

        return true;
      } catch (err) {
        console.warn(`Lần thử kết nối ${attempt}/${retries} thất bại:`, err.message);

        // Nếu là lỗi mạng tạm thời (fetch failed, network, timeout) và còn lượt thử, chờ rồi thử lại
        const isNetworkErr = err.message && (
          err.message.includes('fetch failed') ||
          err.message.includes('network') ||
          err.message.includes('timeout') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ETIMEDOUT')
        );

        if (attempt < retries && isNetworkErr) {
          const delayTime = attempt * 1200;
          console.log(`Chờ ${delayTime}ms trước khi thử kết nối lại lần ${attempt + 1}...`);
          await new Promise(r => setTimeout(r, delayTime));
          continue;
        }

        if (attempt === retries) {
          console.warn('Hết số lần thử kết nối:', err.message);
          this.onStatusChange({
            status: 'disconnected',
            message: isNetworkErr
              ? 'Lỗi kết nối mạng tới máy chủ Zalo. Bấm Tạo mã QR để đăng nhập lại.'
              : 'Phiên đăng nhập đã hết hạn, vui lòng quét lại mã QR.'
          });
          return false;
        }
      }
    }
    return false;
  }

  // Đăng nhập bằng mã QR
  async startLoginQR() {
    if (this.isConnecting) {
      console.log('Đang trong quá trình kết nối Zalo, reset để thử lại...');
      this.isConnecting = false;
    }
    this.isConnecting = true;

    // Reset listener cũ nếu có
    if (this.listener) {
      try { this.listener.stop(); } catch(e) {}
      this.listener = null;
    }

    return new Promise((resolve, reject) => {
      let qrResolved = false;

      // Timeout an toàn 25 giây để không bao giờ bị 'reply was never sent'
      const safetyTimer = setTimeout(() => {
        if (!qrResolved) {
          qrResolved = true;
          this.isConnecting = false;
          resolve({ success: false, error: 'Quá thời gian tạo mã QR. Vui lòng bấm tạo lại.' });
        }
      }, 25000);

      this.onStatusChange({
        status: 'generating_qr',
        message: 'Đang tạo mã QR đăng nhập...'
      });

      this.zalo = new Zalo({
        selfListen: true,
        checkUpdate: false,
        logging: true,
        polyfill: zaloFetch
      });

      let latestCredentials = null;
      let scannedUserData = null;

      this.zalo.loginQR({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }, async (event) => {
        console.log('LoginQR Event:', event.type);

        // 0: QRCodeGenerated
        if (event.type === 0) {
          let qrImageDataUrl = '';
          try {
            if (event.data && event.data.image) {
              qrImageDataUrl = event.data.image.startsWith('data:image')
                ? event.data.image
                : `data:image/png;base64,${event.data.image}`;
            } else if (event.data && event.data.code) {
              qrImageDataUrl = await QRCode.toDataURL(event.data.code);
            }
          } catch (e) {
            console.error('Lỗi tạo ảnh QR data URL:', e);
          }

          this.onStatusChange({
            status: 'qr_ready',
            message: 'Mở ứng dụng Zalo trên điện thoại và quét mã QR',
            qrImage: qrImageDataUrl
          });

          if (!qrResolved) {
            qrResolved = true;
            clearTimeout(safetyTimer);
            resolve({ success: true, qr: qrImageDataUrl });
          }
        }

        // 1: QRCodeExpired
        else if (event.type === 1) {
          this.onStatusChange({
            status: 'qr_expired',
            message: 'Mã QR đã hết hạn. Vui lòng bấm tạo mã mới.'
          });
        }

        // 2: QRCodeScanned
        else if (event.type === 2) {
          scannedUserData = event.data;
          this.onStatusChange({
            status: 'qr_scanned',
            message: `Đã quét bởi ${event.data.display_name || ''}! Vui lòng xác nhận trên điện thoại.`,
            scannedUser: event.data
          });
        }

        // 3: QRCodeDeclined
        else if (event.type === 3) {
          this.onStatusChange({
            status: 'qr_declined',
            message: 'Bạn đã từ chối yêu cầu đăng nhập trên điện thoại.'
          });
        }

        // 4: GotLoginInfo
        else if (event.type === 4) {
          latestCredentials = event.data;
          console.log('Đã nhận thông tin đăng nhập thành công!');
        }
      }).then(async (api) => {
        this.api = api;
        let realName = scannedUserData?.display_name || '';
        let realAvatar = scannedUserData?.avatar || '';

        try {
          if (this.api && this.api.fetchAccountInfo) {
            const accInfo = await this.api.fetchAccountInfo();
            console.log('fetchAccountInfo kết quả:', accInfo);
            if (accInfo) {
              realName = accInfo.displayName || accInfo.zaloName || accInfo.name || realName;
              realAvatar = accInfo.avatar || accInfo.cover || realAvatar;
            }
          }
        } catch (e) {
          console.warn('Không thể lấy info chi tiết:', e.message);
        }

        if (!realName) realName = 'Người dùng Zalo';

        this.currentUser = {
          name: realName,
          avatar: realAvatar
        };

        if (latestCredentials) {
          this.saveSession({
            ...latestCredentials,
            userInfo: this.currentUser
          });
        }

        this.initListener();

        this.onStatusChange({
          status: 'connecting',
          message: 'Đăng nhập thành công, đang kết nối tin nhắn Zalo',
          user: this.currentUser
        });
        this.isConnecting = false;

        // Tự động nạp danh sách và chi tiết bạn bè & nhóm Zalo
        Promise.allSettled([this.fetchFriendsList(), this.fetchGroupsList()])
          .then(() => this.resolveBackupThreadIdentities())
          .catch(e => console.warn('Lỗi khôi phục tên hội thoại:', e.message));
        this.fetchMuteList().catch(e => console.warn('Lỗi nạp mute sau khi quét QR:', e.message));

      }).catch((err) => {
        console.error('Lỗi loginQR:', err);
        this.isConnecting = false;
        this.onStatusChange({
          status: 'error',
          message: 'Lỗi đăng nhập: ' + (err.message || 'Không xác định')
        });
        if (!qrResolved) {
          qrResolved = true;
          clearTimeout(safetyTimer);
          resolve({ success: false, error: err.message || 'Không thể tạo mã QR' });
        }
      });
    });
  }

  // Khởi động lắng nghe tin nhắn
  initListener() {
    if (!this.api || !this.api.listener) {
      console.warn('Không tìm thấy listener trong API');
      return;
    }

    this.listener = this.api.listener;
    if (this.recentCatchupTimer) clearInterval(this.recentCatchupTimer);
    if (this.recentCatchupScheduledTimer) clearTimeout(this.recentCatchupScheduledTimer);
    this.recentCatchupScheduledTimer = null;
    if (this.listener) {
      this.listener.selfListen = true;
      if (typeof this.listener.setMaxListeners === 'function') {
        this.listener.setMaxListeners(100);
      }
      // Dọn dẹp các listener cũ để tránh trùng lặp khi khởi tạo lại
      if (typeof this.listener.removeAllListeners === 'function') {
        this.listener.removeAllListeners('connected');
        this.listener.removeAllListeners('disconnected');
        this.listener.removeAllListeners('error');
        this.listener.removeAllListeners('message');
        this.listener.removeAllListeners('undo');
        this.listener.removeAllListeners('old_messages');
        this.listener.removeAllListeners('sync_event');
        this.listener.removeAllListeners('cipher_key');
      }
    }

    this.listener.on('connected', () => {
      console.log('Zalo Listener đã kết nối WebSocket!');
      this.onStatusChange({ status: 'connecting', message: 'Đang xác thực luồng tin nhắn Zalo', user: this.currentUser });
    });

    this.listener.on('cipher_key', () => {
      this.onStatusChange({ status: 'connected', message: 'Đang lắng nghe tin nhắn Zalo', user: this.currentUser });
      this.scheduleRecentCatchup();
    });

    this.listener.on('disconnected', (reason) => {
      console.log('Zalo Listener bị ngắt kết nối:', reason);
      this.onStatusChange({ status: 'connecting', message: 'Mất kết nối Zalo, đang kết nối lại...' });

      // CHỈ hoàn tất nếu đã nhận được gói tin cuối cùng từ điện thoại (sawLastPacket), HOẶC đang đồng bộ và đã nhận ít nhất 1 gói nhưng đã qua hơn 30 giây yên lặng
      const timeSinceLastPacket = Date.now() - (this.phoneSyncState?.lastPacketTime || 0);
      if (
        this.phoneSyncState && 
        this.phoneSyncState.active &&
        this.phoneSyncState.packetsReceived > 0 && 
        !this.phoneSyncState.isFinished &&
        (this.phoneSyncState.sawLastPacket || timeSinceLastPacket > 30000)
      ) {
        console.log('Phát hiện kết thúc phiên đồng bộ điện thoại sau khi đã nhận đủ dữ liệu.');
        this.finishPhoneSync().catch(() => {});
      }

      // Tự động kết nối lại sau 2 giây để duy trì nhận tin nhắn liên tục
      setTimeout(() => {
        if (this.api && this.listener && this.api.listener) {
          console.log('Đang tự động kết nối lại Zalo Listener WebSocket...');
          try {
            this.listener.start({ retryOnClose: true });
          } catch (e) {
            if (!e.message || !e.message.includes('Already started')) {
              console.warn('Lỗi reconnect listener:', e.message);
            }
          }
        }
      }, 2000);
    });

    this.listener.on('error', (err) => {
      console.error('Zalo Listener gặp lỗi:', err);
    });

    this.listener.on('message', (message) => {
      const formatted = this.formatMessage(message);
      if (formatted) {
        this.addMessageToHistory(formatted);
        this.onNewMessage(formatted, false);
      }
    });

    // Lắng nghe sự kiện thu hồi tin nhắn từ người khác hoặc chính mình (undo / revoke)
    this.listener.on('undo', (undoObj) => {
      console.log('🔄 [ZaloListener] Nhận sự kiện thu hồi tin nhắn (undo):', undoObj);
      const data = undoObj.data || {};
      const content = data.content || {};
      const targetMsgId = String(content.globalMsgId || data.msgId || data.realMsgId || '');
      const targetCliMsgId = String(content.cliMsgId || data.cliMsgId || '');
      const threadId = String(undoObj.threadId || (undoObj.isGroup ? data.idTo : data.uidFrom) || '');
      const isSelf = Boolean(undoObj.isSelf || data.uidFrom === '0' || (this.currentUser?.userId && data.uidFrom === this.currentUser?.userId));

      // Cập nhật tin nhắn trong lịch sử thành 'Tin nhắn đã được thu hồi'
      let found = false;
      if (this.messagesHistory && this.messagesHistory.length > 0) {
        for (const msg of this.messagesHistory) {
          if (threadId && String(msg.threadId).replace(/^g_/, '') !== threadId.replace(/^g_/, '')) continue;
          const matchId = targetMsgId && (String(msg.id) === targetMsgId || String(msg.msgId) === targetMsgId);
          const matchCli = targetCliMsgId && (String(msg.cliMsgId) === targetCliMsgId);
          if (matchId || matchCli) {
            msg.isUndo = true;
            msg.isRevoked = true;
            msg.isRecalled = true;
            msg.content = 'Tin nhắn đã được thu hồi';
            msg.isPhoto = false;
            msg.photoUrl = '';
            msg.thumbUrl = '';
            msg.isVideo = false;
            msg.videoUrl = '';
            msg.isSticker = false;
            msg.stickerUrl = '';
            msg.isFile = false;
            msg.isLink = false;
            found = true;
            break;
          }
        }
      }

      // NẾU CHƯA CÓ TRONG LỊCH SỬ (người khác gửi rồi thu hồi luôn hoặc tin nhắn cũ chưa kịp nạp)
      // TẠO MỚI một dòng tin nhắn thu hồi để hiển thị ngay lập tức trên UI
      if (!found && threadId) {
        const revokedMsg = {
          id: targetMsgId || ('undo_' + Date.now()),
          cliMsgId: targetCliMsgId || String(Date.now()),
          msgType: 'chat.undo',
          senderName: data.dName || (isSelf ? 'Bạn (Tôi)' : 'Người gửi'),
          senderId: String(data.uidFrom || (isSelf ? (this.currentUser?.userId || 'me') : threadId)),
          threadId: threadId,
          threadName: undoObj.isGroup ? (this.cachedGroups[threadId]?.name || 'Nhóm Zalo') : (data.dName || 'Bạn bè Zalo'),
          threadAvatar: '',
          avatar: '',
          content: 'Tin nhắn đã được thu hồi',
          isPhoto: false,
          photoUrl: '',
          thumbUrl: '',
          isSticker: false,
          stickerUrl: '',
          isVideo: false,
          videoUrl: '',
          isGroup: Boolean(undoObj.isGroup),
          isSelf: isSelf,
          isMuted: this.isThreadMuted(threadId),
          isUndo: true,
          isRevoked: true,
          isRecalled: true,
          isFile: false,
          isLink: false,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          timestamp: Number(data.ts) || Date.now()
        };
        this.addMessageToHistory(revokedMsg);
        if (typeof this.onNewMessage === 'function') {
          this.onNewMessage(revokedMsg, false);
        }
      }

      this.scheduleSaveMessages();

      // Phát sự kiện thu hồi tin nhắn sang renderer
      if (typeof this.onMessageUndo === 'function') {
        this.onMessageUndo({
          threadId: threadId,
          msgId: targetMsgId,
          cliMsgId: targetCliMsgId,
          isGroup: undoObj.isGroup,
          isSelf: isSelf,
          senderName: data.dName || (isSelf ? 'Bạn (Tôi)' : 'Người gửi')
        });
      }
    });

    // Lắng nghe sự kiện reaction từ Zalo (cmd 612)
    this.listener.on('reaction', (reaction) => {
      console.log('❤️ [ZaloListener] Nhận sự kiện reaction:', JSON.stringify(reaction));
      try {
        const data = reaction.data || {};
        const content = data.content || {};
        const rMsgList = content.rMsg || [];
        const rType = content.rType;
        const rIcon = content.rIcon;

        const typeToEmoji = {
          5: '❤️',
          3: '👍',
          0: '😂',
          32: '😮',
          2: '😢',
          20: '😡'
        };
        const iconToEmoji = {
          '/-heart': '❤️',
          '/-strong': '👍',
          ':>': '😂',
          ':o': '😮',
          ':-((': '😢',
          ':-h': '😡'
        };
        const emoji = typeToEmoji[rType] || iconToEmoji[rIcon] || '❤️';

        const senderId = String(data.uidFrom || data.reactSender || '');
        const isSelf = senderId === '0' || (this.currentUser?.userId && senderId === this.currentUser.userId);
        const senderName = isSelf ? 'Bạn (Tôi)' : (data.dName || 'Thành viên');
        const rawThreadId = String(reaction.threadId || (reaction.isGroup ? data.idTo : data.uidFrom) || '');
        const threadId = reaction.isGroup && !rawThreadId.startsWith('g_') ? ('g_' + rawThreadId) : rawThreadId;

        for (const rMsg of rMsgList) {
          const targetMsgId = String(rMsg.gMsgID || '');
          const targetCliMsgId = String(rMsg.cMsgID || '');

          const target = this.messagesHistory.find(m =>
            String(m.threadId).replace(/^g_/, '') === rawThreadId.replace(/^g_/, '') && (
              (targetMsgId && targetMsgId !== '0' && (String(m.id) === targetMsgId || String(m.msgId) === targetMsgId)) ||
              (targetCliMsgId && String(m.cliMsgId) === targetCliMsgId)
            )
          );

          if (target) {
            if (!target.reactions) target.reactions = [];
            const exIdx = target.reactions.findIndex(r => r.senderId === senderId);
            if (rType === -1) {
              if (exIdx >= 0) target.reactions.splice(exIdx, 1);
            } else {
              if (exIdx >= 0) {
                target.reactions[exIdx].icon = emoji;
                target.reactions[exIdx].senderName = senderName;
              } else {
                target.reactions.push({
                  icon: emoji,
                  senderId: senderId,
                  senderName: senderName
                });
              }
            }
          }

          if (typeof this.onReactionUpdate === 'function') {
            this.onReactionUpdate({
              threadId: threadId,
              msgId: targetMsgId,
              cliMsgId: targetCliMsgId,
              icon: emoji,
              reactions: target?.reactions || [],
              senderId: senderId,
              senderName: senderName,
              isSelf: isSelf
            });
          }
        }

        this.scheduleSaveMessages();
      } catch (err) {
        console.error('Lỗi xử lý sự kiện reaction:', err);
      }
    });

    // Lắng nghe reaction cũ (cmd 610/611)
    this.listener.on('old_reactions', (reactionObjects, isGroup) => {
      console.log(`❤️ [ZaloListener] Nhận ${reactionObjects?.length || 0} reaction cũ (group=${isGroup})`);
      if (!Array.isArray(reactionObjects)) return;
      try {
        for (const reaction of reactionObjects) {
          const data = reaction.data || {};
          let content = data.content;
          if (typeof content === 'string') {
            try { content = JSON.parse(content); } catch (e) {}
          }
          if (!content) continue;
          const rMsgList = content.rMsg || [];
          const rType = content.rType;
          const rIcon = content.rIcon;
          const typeToEmoji = { 5: '❤️', 3: '👍', 0: '😂', 32: '😮', 2: '😢', 20: '😡' };
          const iconToEmoji = { '/-heart': '❤️', '/-strong': '👍', ':>': '😂', ':o': '😮', ':-((': '😢', ':-h': '😡' };
          const emoji = typeToEmoji[rType] || iconToEmoji[rIcon] || '❤️';
          const senderId = String(data.uidFrom || data.reactSender || '');
          const isSelf = senderId === '0' || (this.currentUser?.userId && senderId === this.currentUser.userId);
          const senderName = isSelf ? 'Bạn (Tôi)' : (data.dName || 'Thành viên');

          for (const rMsg of rMsgList) {
            const targetMsgId = String(rMsg.gMsgID || '');
            const targetCliMsgId = String(rMsg.cMsgID || '');

            const target = this.messagesHistory.find(m =>
              (targetMsgId && targetMsgId !== '0' && (String(m.id) === targetMsgId || String(m.msgId) === targetMsgId)) ||
              (targetCliMsgId && String(m.cliMsgId) === targetCliMsgId)
            );

            if (target) {
              if (!target.reactions) target.reactions = [];
              const exIdx = target.reactions.findIndex(r => r.senderId === senderId);
              if (rType === -1) {
                if (exIdx >= 0) target.reactions.splice(exIdx, 1);
              } else {
                if (exIdx >= 0) {
                  target.reactions[exIdx].icon = emoji;
                  target.reactions[exIdx].senderName = senderName;
                } else {
                  target.reactions.push({
                    icon: emoji,
                    senderId: senderId,
                    senderName: senderName
                  });
                }
              }

              if (typeof this.onReactionUpdate === 'function') {
                this.onReactionUpdate({
                  threadId: target.threadId,
                  msgId: targetMsgId,
                  cliMsgId: targetCliMsgId,
                  icon: emoji,
                  reactions: target.reactions,
                  senderId: senderId,
                  senderName: senderName,
                  isSelf: isSelf
                });
              }
            }
          }
        }
        this.scheduleSaveMessages();
      } catch (err) {
        console.error('Lỗi nạp reaction cũ:', err);
      }
    });

    // Lắng nghe sự kiện đồng bộ tin nhắn cũ từ Zalo
    this.listener.on('old_messages', (messages, threadType) => {
      if (this.isRecentCatchupActive) return;
      const typeStr = threadType === 1 ? 'nhóm' : 'cá nhân';
      const msgList = Array.isArray(messages) ? messages : [];
      console.log(`Đã nhận ${msgList.length} tin nhắn cũ (${typeStr}) từ Zalo`);
      if (this.bulkHistoryMode) {
        const formatted = msgList.map(msg => this.formatMessage(msg)).filter(Boolean);
        if (formatted.length) this.messageStore.putMany(formatted);
        return;
      }
      for (const msg of msgList) {
        const formatted = this.formatMessage(msg);
        if (formatted) {
          this.addMessageToHistory(formatted, false);
          this.onNewMessage(formatted, true);
        }
      }
      this.scheduleSaveMessages();
    });

    // Lắng nghe sự kiện phản hồi đồng bộ từ điện thoại (sync_event)
    this.listener.on('sync_event', async (event) => {
      if (!this.phoneSyncState?.active) return;
      // Metadata chứa URL tải và khóa mã hóa; không ghi toàn bộ payload ra log.
      console.log('📱 Sự kiện đồng bộ từ điện thoại (sync_event):', event.act);
      if (this.syncPublicKey && event.data?.public_key && event.data.public_key !== this.syncPublicKey) return;

      const statusNum = Number(event.data?.status);
      const isWaitingConfirm = (event.act === 'transfer_status' && statusNum === 3);
      const isConfirmed = event.act === 'user_confirm' || 
        (event.act === 'transfer_status' && (statusNum === 4 || statusNum === 5));
      const isRejected = (event.act === 'transfer_status' && statusNum === 6);
      const isCancelled = (event.act === 'transfer_status' && statusNum === 7);
      const isBusy = (event.act === 'transfer_status' && (statusNum === 8 || statusNum === 9));

      if (isWaitingConfirm) {
        console.log('📱 Điện thoại Zalo đã nhận được yêu cầu đồng bộ và đang hiển thị popup xác nhận!');
        this.onSyncStatus({
          phase: 'phone_waiting_confirm',
          title: 'Điện thoại đã nhận yêu cầu!',
          message: 'Vui lòng mở ứng dụng Zalo trên điện thoại của bạn và bấm chọn "ĐỒNG BỘ NGAY".',
          step: 1,
          progress: 20
        });
      } else if (isConfirmed) {
        console.log('📱 Người dùng đã bấm Đồng bộ ngay trên điện thoại! Bắt đầu chuẩn bị dữ liệu...');
        this.phoneSyncState.isWaiting = false;
        this.phoneSyncState.isPreparing = true;
        this.phoneSyncState.isFinished = false;
        this.phoneSyncState.startTime = Date.now();
        if (this.phoneSyncTimeout) clearTimeout(this.phoneSyncTimeout);
        this.phoneSyncTimeout = setTimeout(() => {
          if (this.phoneSyncState?.active) this.failPhoneSync('Điện thoại đã xác nhận nhưng không hoàn tất truyền dữ liệu trong thời gian chờ.');
        }, 5 * 60 * 1000);
        this.phoneSyncTimeout.unref?.();

        this.onSyncStatus({
          phase: 'phone_preparing',
          title: 'Điện thoại đang chuẩn bị dữ liệu...',
          message: 'Điện thoại đang nén và đóng gói tin nhắn để truyền sang máy tính (0% -> 50%). Vui lòng giữ màn hình sáng!',
          step: 2,
          progress: 35
        });

        this.onStatusChange({
          status: 'phone_sync_confirmed',
          message: '📱 Điện thoại đang chuẩn bị dữ liệu...',
          user: this.currentUser
        });

      } else if (isRejected) {
        console.warn('📱 Người dùng đã bấm "Từ chối" đồng bộ trên điện thoại!');
        this.failPhoneSync('Bạn đã từ chối yêu cầu đồng bộ trên điện thoại Zalo.', 'phone_rejected');
      } else if (isCancelled) {
        console.warn('📱 Yêu cầu đồng bộ đã bị hủy trên điện thoại!');
        this.failPhoneSync('Yêu cầu đồng bộ đã bị hủy trên điện thoại Zalo.', 'phone_cancelled');
      } else if (isBusy) {
        console.warn('📱 Điện thoại Zalo đang bận hoặc đầy bộ nhớ!');
        this.failPhoneSync(statusNum === 9 ? 'Điện thoại không đủ dung lượng bộ nhớ để sao lưu.' : 'Điện thoại đang bận xử lý tác vụ khác, vui lòng thử lại sau giây lát.', 'phone_busy');
      } else if (event.act === 'syncmsg_info' || event.act === 'upload_batch' || event.act === 'sync_chunk') {
        this.phoneSyncState.isWaiting = false;
        this.phoneSyncState.packetsReceived++;
        this.phoneSyncState.lastPacketTime = Date.now();
        if (this.phoneSyncTimeout) clearTimeout(this.phoneSyncTimeout);
        this.phoneSyncTimeout = setTimeout(() => {
          if (this.phoneSyncState?.active) this.failPhoneSync('Không nhận thêm dữ liệu từ điện thoại trong 5 phút. Đồng bộ chưa hoàn tất.');
        }, 5 * 60 * 1000);
        this.phoneSyncTimeout.unref?.();

        const fileName = event.data?.file_name || `Gói ${this.phoneSyncState.packetsReceived}`;
        // syncmsg_info xác nhận điện thoại đã tạo bản sao lưu và gửi metadata.
        // Dữ liệu trong URL chưa được tải và nhập vào ứng dụng ở bước này.
        const isSyncMsgInfo = event.act === 'syncmsg_info';
        const isLastPacket = Boolean(
          isSyncMsgInfo ||
          event.data?.isLast || 
          event.data?.is_last === true || 
          event.data?.is_last === 1 ||
          (event.data?.total && event.data?.idx && event.data.idx >= event.data.total) ||
          (event.data?.total_parts && event.data?.part && event.data.part >= event.data.total_parts) ||
          (event.data?.total_file && event.data?.file_index && event.data.file_index >= event.data.total_file)
        );

        if (isLastPacket) {
          this.phoneSyncState.sawLastPacket = true;
          if (isSyncMsgInfo) this.phoneSyncState.isPreparing = true;
        }

        // Trích xuất metadata sao lưu từ điện thoại
        let totalMsgs = 0;
        let totalThreads = 0;
        let dbInfo = null;
        if (event.data?.db_info) {
          try {
            dbInfo = typeof event.data.db_info === 'string' ? JSON.parse(event.data.db_info) : event.data.db_info;
            totalMsgs = Number(dbInfo.backup_db?.msg_total || dbInfo.origin_db?.msg_total || 0);
            totalThreads = Number(dbInfo.backup_db?.msg_thread || dbInfo.origin_db?.msg_thread || 0);
          } catch (e) {}
        }
        const deviceName = event.data?.device_name || 'Điện thoại Zalo';
        const fileSize = Number(event.data?.file_size || 0);
        const fileSizeMb = fileSize > 0 ? (fileSize / (1024 * 1024)).toFixed(1) : null;

        if (isSyncMsgInfo || totalMsgs > 0) {
          this.phoneSyncBackupInfo = {
            deviceName,
            plainUserId: String(event.data?.uid || this.phoneSyncBackupInfo?.plainUserId || ''),
            fileName,
            fileSize,
            fileSizeMb,
            totalMsgs,
            totalThreads,
            format: Number(dbInfo?.db_format ?? 0),
            url: event.data?.url || '',
            encryptedKey: event.data?.encrypted_key || '',
            checksum: event.data?.checksum_code || event.data?.checksum || '',
            receivedAt: Date.now()
          };
        }

        // Đây là tiến trình tạo bản sao lưu trên điện thoại, chưa phải tiến trình nhập tin nhắn.
        let currentProgress = isLastPacket ? 75 : 52;
        if (!isLastPacket) {
          if (this.phoneSyncState.packetsReceived === 2) currentProgress = 70;
          else if (this.phoneSyncState.packetsReceived > 2) currentProgress = Math.min(88, 70 + this.phoneSyncState.packetsReceived * 5);
        }

        console.log(`📱 Nhận gói dữ liệu sao lưu ${fileName} từ điện thoại (isLast: ${isLastPacket}, Tiến trình: ~${currentProgress}%)...`);

        const elapsedSec = Math.floor((Date.now() - (this.phoneSyncState.startTime || Date.now())) / 1000);
        const sizeInfo = fileSizeMb ? ` dung lượng ${fileSizeMb} MB` : '';
        const msgInfo = totalMsgs > 0 ? ` (${totalThreads.toLocaleString('vi-VN')} hội thoại, ${totalMsgs.toLocaleString('vi-VN')} tin nhắn)` : '';

        this.onSyncStatus({
          phase: 'phone_transferring',
          title: isSyncMsgInfo ? 'Điện thoại đã tạo bản sao lưu' : `Điện thoại đang truyền dữ liệu (~${currentProgress}%)...`,
          message: isLastPacket
            ? `Đã nhận thông tin bản sao lưu [${fileName}]${sizeInfo} từ ${deviceName}${msgInfo}. Đang kiểm tra tin nhắn đã lưu trên máy.`
            : `Đang nhận gói tin sao lưu [${fileName}] (Đã nhận ${this.phoneSyncState.packetsReceived} gói). Dữ liệu lớn có thể mất vài phút!`,
          step: 2,
          progress: currentProgress,
          packets: this.phoneSyncState.packetsReceived,
          elapsedSec
        });

        if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);

        if (isLastPacket) {
          console.log('📱 Điện thoại đã gửi thông tin bản sao lưu; đang kiểm tra lịch sử khả dụng.');
          this.syncDebounceTimer = setTimeout(() => {
            this.finishPhoneSync().catch(e => console.warn('Lỗi finishPhoneSync:', e));
          }, 2000);
        } else {
          this.syncDebounceTimer = setTimeout(() => {
            this.failPhoneSync('Không nhận được gói tiếp theo từ điện thoại trong 65 giây. Đồng bộ chưa hoàn tất.');
          }, 65000);
        }

      } else if (event.act === 'transfer_error') {
        const errorCode = Number(event.data?.error_code ?? 0);
        if (errorCode === 0) {
          // Zalo PC chỉ xem transfer_error là lỗi khi error_code khác 0.
          // Mã 0 không xác nhận rằng ứng dụng đã tải hoặc nhập bản sao lưu.
          console.log('📱 Nhận transfer_error mã 0; giữ nguyên trạng thái đồng bộ hiện tại.');
        } else {
          console.warn('📱 Điện thoại Zalo báo lỗi truyền dữ liệu:', errorCode);
          const errorMsg = event.data?.error_msg || `Mã lỗi điện thoại: ${errorCode}`;
          this.failPhoneSync(errorMsg, 'phone_transfer_error');
        }

      } else if (event.act === 'sync_done' || event.act === 'transfer_completed' || event.act === 'sync_complete') {
        console.log('📱 Điện thoại đã phát sự kiện hoàn tất 100%:', event.act);
        this.phoneSyncState.sawLastPacket = true;
        if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
        this.finishPhoneSync().catch(e => console.warn('Lỗi finishPhoneSync:', e));
      }
    });

    // Bắt đầu lắng nghe
    try {
      this.listener.start({ retryOnClose: true });
    } catch (e) {
      if (!e.message || !e.message.includes('Already started')) {
        console.warn('Cảnh báo listener.start:', e.message);
      }
    }
    if (this.listener.ws?.readyState === 1 && this.listener.cipherKey) this.scheduleRecentCatchup();

    this.recentCatchupTimer = setInterval(() => {
      if (!this.api || !this.listener) return;
      if (this.listener.ws?.readyState === 1 && this.listener.cipherKey) {
        this.scheduleRecentCatchup();
      } else if (!this.listener.ws) {
        try { this.listener.start({ retryOnClose: true }); }
        catch (error) { if (!/Already started/i.test(error.message || '')) console.warn('Không thể kết nối lại Zalo:', error.message); }
      }
    }, 90 * 1000);
    this.recentCatchupTimer.unref?.();
  }

  scheduleRecentCatchup() {
    if (this.recentCatchupScheduledTimer) clearTimeout(this.recentCatchupScheduledTimer);
    this.recentCatchupScheduledTimer = setTimeout(() => {
      this.recentCatchupScheduledTimer = null;
      const work = this.startupQuickSyncPending
        ? this.runStartupQuickSync() : this.catchUpRecentMessages();
      work.catch(error => console.warn('Không thể tải bù tin nhắn mới:', error.message));
    }, this.recentCatchupDelayMs);
    this.recentCatchupScheduledTimer.unref?.();
  }

  requestStartupQuickSync() {
    this.startupQuickSyncPending = true;
    if (this.listener?.ws?.readyState === 1 && this.listener.cipherKey) {
      this.scheduleRecentCatchup();
    }
  }

  async runStartupQuickSync() {
    if (!this.startupQuickSyncPending) return { skipped: true };
    if (this.startupQuickSyncPromise) return this.startupQuickSyncPromise;
    const work = async () => {
      this.onSyncStatus({ phase: 'startup_scanning', title: 'Đang tự động đồng bộ nhanh',
        message: 'Đang kiểm tra tin nhắn mới sau khi kết nối Zalo.' });
      try {
        const result = await this.catchUpRecentMessages();
        if (result?.skipped) {
          this.onSyncStatus({ phase: 'startup_deferred', title: 'Đang chờ kết nối Zalo',
            message: 'Sẽ thử đồng bộ nhanh khi kết nối sẵn sàng.' });
          return result;
        }
        this.startupQuickSyncPending = false;
        const added = Number(result?.added || 0);
        this.onSyncStatus({ phase: 'startup_completed', title: 'Đã đồng bộ nhanh khi khởi động',
          message: `Đã lưu thêm ${added} tin nhắn mới.`, added });
        return { success: true, added };
      } catch (error) {
        this.onSyncStatus({ phase: 'startup_failed', title: 'Chưa thể đồng bộ nhanh',
          message: error.message });
        return { success: false, error: error.message };
      }
    };
    this.startupQuickSyncPromise = work().finally(() => { this.startupQuickSyncPromise = null; });
    return this.startupQuickSyncPromise;
  }

  async requestRecentPage(threadType, cursor = null) {
    const listener = this.listener;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        listener.removeListener('old_messages', onMessages);
        listener.removeListener('disconnected', onDisconnect);
      };
      const onMessages = (messages, type) => {
        if (type !== threadType || settled) return;
        settled = true;
        cleanup();
        resolve(Array.isArray(messages) ? messages : []);
      };
      const onDisconnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('WebSocket Zalo đã ngắt kết nối khi tải tin mới'));
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Hết thời gian chờ tin nhắn mới từ Zalo'));
      }, 8000);
      listener.on('old_messages', onMessages);
      listener.once('disconnected', onDisconnect);
      try { listener.requestOldMessages(threadType, cursor); }
      catch (error) { if (!settled) { settled = true; cleanup(); reject(error); } }
    });
  }

  async catchUpRecentMessages() {
    if (this.recentCatchupPromise) return this.recentCatchupPromise;
    if (!this.api || !this.listener || this.listener.ws?.readyState !== 1 ||
      this.isSyncing || this.activeScanPromise || this.phoneSyncState?.active) return { added: 0, skipped: true };
    const work = async () => {
      this.isRecentCatchupActive = true;
      let added = 0;
      for (const threadType of [0, 1]) {
        let cursor = this.recentCatchupCursors[threadType] || null;
        const seenCursors = new Set();
        for (let page = 0; page < this.recentCatchupPageLimit; page++) {
          if (this.listener.ws?.readyState !== 1) throw new Error('WebSocket Zalo đã ngắt kết nối');
          const messages = await this.requestRecentPage(threadType, cursor);
          if (!messages.length) { this.recentCatchupCursors[threadType] = null; break; }
          const newMessages = [];
          let reachedKnown = false;
          for (const raw of messages) {
            const formatted = this.formatMessage(raw);
            if (!formatted) continue;
            if (this.messageStore.hasMessage(formatted.threadId, formatted.id,
              formatted.cliMsgId, formatted.isGroup) ||
              this.pendingHistoryMessages.has(`${formatted.threadId}\0${formatted.id}`)) {
              reachedKnown = true;
              this.enrichExistingPhotoCaption(formatted);
            } else {
              newMessages.push(formatted);
            }
          }
          if (newMessages.length) {
            this.messageStore.putMany(newMessages);
            this.messagesHistory = [...newMessages, ...this.messagesHistory]
              .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
              .slice(0, MAX_LOCAL_MESSAGES);
            for (const message of newMessages) this.onNewMessage(message, true);
            added += newMessages.length;
          }
          if (reachedKnown || messages.length < 50) {
            this.recentCatchupCursors[threadType] = null;
            break;
          }
          const nextCursor = String(messages.at(-1)?.data?.actionId || messages.at(-1)?.data?.msgId || '');
          if (!nextCursor || seenCursors.has(nextCursor)) {
            this.recentCatchupCursors[threadType] = null;
            break;
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
          this.recentCatchupCursors[threadType] = cursor;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      this.lastRecentCheckTime = Date.now();
      this.lastRecentAdded = added;
      if (added) console.log(`Đã tự động tải bù ${added} tin nhắn mới từ Zalo.`);
      return { added };
    };
    this.recentCatchupPromise = work().finally(() => {
      this.isRecentCatchupActive = false;
      this.recentCatchupPromise = null;
    });
    return this.recentCatchupPromise;
  }

  enrichExistingPhotoCaption(formatted) {
    if (!formatted?.isPhoto || !formatted.photoCaption) return null;
    const updated = this.messageStore.enrichPhotoCaption(formatted.threadId,
      formatted.id, formatted.cliMsgId, formatted.isGroup, formatted.photoCaption);
    if (!updated) return null;
    for (const message of this.messagesHistory || []) {
      if (String(message.id) === String(updated.id) &&
        String(message.threadId) === String(updated.threadId)) message.photoCaption = updated.photoCaption;
    }
    this.onPhotoCaptionUpdate({ threadId: updated.threadId, msgId: updated.id,
      photoCaption: updated.photoCaption });
    return updated;
  }

  // Quét đến khi máy chủ hết trang; lưu từng trang thẳng vào SQLite thay vì giữ toàn bộ trong RAM.
  async scanAllAvailableMessages() {
    if (this.activeScanPromise) {
      try { await this.activeScanPromise; } catch (_) {}
    }
    this.flushMessagesHistory();
    this.bulkHistoryMode = true;
    try {
      return await this.scanOldMessages(null);
    } finally {
      this.bulkHistoryMode = false;
      this.flushMessagesHistory();
      this.messagesHistory = this.messageStore.getRecent(MAX_LOCAL_MESSAGES);
    }
  }

  // Quét tin nhắn cũ từ WebSocket Zalo (phân trang bằng actionId).
  // null = quét đến trang rỗng; giới hạn an toàn ngăn vòng lặp server vô hạn.
  async scanOldMessages(maxPages = null) {
    if (!this.listener || !this.listener.requestOldMessages) return 0;

    // Tránh chạy song song nhiều luồng quét gây quá tải socket và cảnh báo rò rỉ bộ nhớ listener
    if (this.activeScanPromise) {
      return await this.activeScanPromise;
    }

    this.activeScanPromise = this._executeScanOldMessages(maxPages);
    try {
      return await this.activeScanPromise;
    } finally {
      this.activeScanPromise = null;
      this.lastOldScanTime = Date.now();
    }
  }

  async _executeScanOldMessages(maxPages = null) {
    if (!this.listener || !this.listener.requestOldMessages) return 0;

    // Đợi tối đa 3.5s nếu WebSocket chưa OPEN
    let waitCount = 0;
    while ((!this.listener.ws || this.listener.ws.readyState !== 1) && waitCount < 18) {
      await new Promise(r => setTimeout(r, 200));
      waitCount++;
    }
    if (!this.listener.ws || this.listener.ws.readyState !== 1) {
      throw new Error('WebSocket Zalo chưa kết nối');
    }

    let totalLoaded = 0;
    const fullScan = maxPages == null;
    const pageLimit = fullScan ? 10000 : Math.max(1, Math.trunc(Number(maxPages) || 1));

    // 1. Quét tin nhắn cá nhân (ThreadType.User = 0)
    try {
      let lastUserId = null;
      const seenUserCursors = new Set();
      for (let page = 0; page < pageLimit; page++) {
        if (!this.listener.ws || this.listener.ws.readyState !== 1) {
          throw new Error('WebSocket Zalo đã ngắt kết nối khi tải lịch sử');
        }

        const pageMsgs = await new Promise((resolve, reject) => {
          let timeout = null;
          let settled = false;

          const cleanup = () => {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            if (this.listener && typeof this.listener.removeListener === 'function') {
              this.listener.removeListener('old_messages', handler);
              this.listener.removeListener('disconnected', onDisconnect);
            }
          };

          const handler = (messages, threadType) => {
            if (threadType === 0) {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(messages || []);
            }
          };

          const onDisconnect = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('WebSocket Zalo đã ngắt kết nối khi tải lịch sử'));
          };

          timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Hết thời gian chờ trang lịch sử từ Zalo'));
          }, 8000);

          this.listener.on('old_messages', handler);
          this.listener.once('disconnected', onDisconnect);
          try {
            this.listener.requestOldMessages(0, lastUserId);
          } catch (e) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(e);
          }
        });

        if (!Array.isArray(pageMsgs) || pageMsgs.length === 0) {
          break; // Đã quét hết toàn bộ tin nhắn cá nhân
        }

        totalLoaded += pageMsgs.length;

        const lastMsg = pageMsgs[pageMsgs.length - 1];
        const nextId = lastMsg?.data?.actionId || lastMsg?.data?.msgId;
        if (!nextId || seenUserCursors.has(String(nextId))) {
          throw new Error('Cursor trang lịch sử cá nhân bị thiếu hoặc lặp; chưa thể xác nhận đã tải hết tin.');
        }
        seenUserCursors.add(String(nextId));
        lastUserId = String(nextId);
        if (fullScan && page === pageLimit - 1) throw new Error('Đã chạm giới hạn an toàn khi tải lịch sử cá nhân; chưa tải hết tin.');
        if (this.scanDelayMs > 0) await new Promise(r => setTimeout(r, this.scanDelayMs));
      }
    } catch (e) {
      console.warn('Lỗi scanOldMessages (User):', e.message);
      throw e;
    }

    // 2. Quét tin nhắn nhóm (ThreadType.Group = 1)
    try {
      let lastGroupId = null;
      const seenGroupCursors = new Set();
      for (let page = 0; page < pageLimit; page++) {
        if (!this.listener.ws || this.listener.ws.readyState !== 1) {
          throw new Error('WebSocket Zalo đã ngắt kết nối khi tải lịch sử');
        }

        const pageMsgs = await new Promise((resolve, reject) => {
          let timeout = null;
          let settled = false;

          const cleanup = () => {
            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }
            if (this.listener && typeof this.listener.removeListener === 'function') {
              this.listener.removeListener('old_messages', handler);
              this.listener.removeListener('disconnected', onDisconnect);
            }
          };

          const handler = (messages, threadType) => {
            if (threadType === 1) {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(messages || []);
            }
          };

          const onDisconnect = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('WebSocket Zalo đã ngắt kết nối khi tải lịch sử'));
          };

          timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Hết thời gian chờ trang lịch sử từ Zalo'));
          }, 8000);

          this.listener.on('old_messages', handler);
          this.listener.once('disconnected', onDisconnect);
          try {
            this.listener.requestOldMessages(1, lastGroupId);
          } catch (e) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(e);
          }
        });

        if (!Array.isArray(pageMsgs) || pageMsgs.length === 0) {
          break;
        }

        totalLoaded += pageMsgs.length;

        const lastMsg = pageMsgs[pageMsgs.length - 1];
        const nextId = lastMsg?.data?.actionId || lastMsg?.data?.msgId;
        if (!nextId || seenGroupCursors.has(String(nextId))) {
          throw new Error('Cursor trang lịch sử nhóm bị thiếu hoặc lặp; chưa thể xác nhận đã tải hết tin.');
        }
        seenGroupCursors.add(String(nextId));
        lastGroupId = String(nextId);
        if (fullScan && page === pageLimit - 1) throw new Error('Đã chạm giới hạn an toàn khi tải lịch sử nhóm; chưa tải hết tin.');
        if (this.scanDelayMs > 0) await new Promise(r => setTimeout(r, this.scanDelayMs));
      }
    } catch (e) {
      console.warn('Lỗi scanOldMessages (Group):', e.message);
      throw e;
    }

    return totalLoaded;
  }

  async resolveBackupThreadIdentities() {
    if (!this.api) return { mapped: 0, named: 0 };
    if (this.identitySyncPromise) return this.identitySyncPromise;
    const work = async () => {
      const unresolved = this.messageStore.getUnresolvedBackupThreads();
      if (!unresolved.length && !this.messageStore.getPendingThreadProfiles().length) return { mapped: 0, named: 0 };
      let mapped = [];
      if (unresolved.length) {
        const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
        mapped = await requestNoisedIds({ ctx: this.api.getContext(),
          utils: this.identityUtils || require(utilsPath),
          sessionCookies: this.loadSession()?.cookie || [], threads: unresolved });
        this.messageStore.saveThreadIdentities(mapped);
      }
      const pending = this.messageStore.getPendingThreadProfiles();
      const named = await fetchThreadProfiles({ api: this.api, mappings: pending,
        friends: this.cachedFriends || [], groups: this.cachedGroups || {} });
      this.messageStore.saveThreadIdentities(named);
      this.flushMessagesHistory();
      this.messagesHistory = this.messageStore.getRecent(MAX_LOCAL_MESSAGES);
      const namedCount = named.filter(item => item.name).length;
      this.onSyncStatus({ phase: 'identities_updated', mapped: mapped.length, named: namedCount });
      console.log(`Đã khôi phục ID của ${mapped.length} hội thoại và tên của ${namedCount} hội thoại.`);
      return { mapped: mapped.length, named: namedCount };
    };
    this.identitySyncPromise = work().finally(() => { this.identitySyncPromise = null; });
    return this.identitySyncPromise;
  }

  async resolveGroupSenderNames(threadId, senderIds = []) {
    if (!this.api || !threadId || !Array.isArray(senderIds)) return [];
    const ids = [...new Set(senderIds.map(String))]
      .filter(id => /^\d{7,11}$/.test(id) && id !== this.messageStore.ownPlainId)
      .slice(0, 50);
    if (!ids.length) return [];
    const unresolved = ids.filter(id => !this.messageStore.identityByPlain.has(id))
      .map(plainId => ({ plainId, isGroup: false }));
    if (unresolved.length) {
      const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
      const mapped = await requestNoisedIds({ ctx: this.api.getContext(),
        utils: this.identityUtils || require(utilsPath),
        sessionCookies: this.loadSession()?.cookie || [], threads: unresolved });
      this.messageStore.saveThreadIdentities(mapped);
    }
    const pending = ids.map(id => this.messageStore.identityByPlain.get(id)).filter(item => item && !item.name);
    if (pending.length) {
      const named = await fetchThreadProfiles({ api: this.api, mappings: pending,
        friends: this.cachedFriends || [], groups: this.cachedGroups || {} });
      this.messageStore.saveThreadIdentities(named);
    }
    return ids.map(id => this.messageStore.identityByPlain.get(id))
      .filter(item => item?.name)
      .map(item => ({ plainId: item.plainId, name: item.name, avatar: item.avatar || '' }));
  }

  async importPhoneBackup(backupInfo) {
    if (backupInfo.format !== 1) throw new Error(`Chưa hỗ trợ định dạng bản sao lưu ZaloDB ${backupInfo.format}`);
    if (!backupInfo.url || !backupInfo.encryptedKey || !this.syncPrivateKey) {
      throw new Error('Thiếu URL hoặc khóa giải mã của bản sao lưu điện thoại');
    }
    const os = require('node:os');
    const tempBase = path.resolve(app?.getPath?.('temp') || os.tmpdir());
    const workRoot = fs.mkdtempSync(path.join(tempBase, 'nhitzalo-zalo-backup-'));
    const inputPath = path.join(workRoot, 'ZaloDB_2');
    const outputPath = path.join(workRoot, 'decrypted');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const zaloDirectory = process.env.NHIT_ZALO_PC_DIR || path.join(localAppData, 'Programs', 'Zalo', 'Zalo-26.10.20');
    try {
      const ctx = this.api.getContext();
      this.onSyncStatus({ phase: 'downloading_backup', title: 'Đang tải bản sao lưu điện thoại',
        message: `Đang tải ${backupInfo.fileSizeMb || '?'} MB dữ liệu từ Zalo.`, step: 3, progress: 78 });
      await downloadBackup({ url: backupInfo.url, fileSize: backupInfo.fileSize,
        checksum: backupInfo.checksum, outputPath: inputPath, ctx,
        sessionCookies: this.loadSession()?.cookie,
        diagnosticPath: path.join(this.accountDataDir, 'sync-download-diagnostics.log') });

      const key = decryptBackupKey(backupInfo.encryptedKey, this.syncPrivateKey);
      this.onSyncStatus({ phase: 'decrypting_backup', title: 'Đang giải mã bản sao lưu',
        message: 'Zalo PC đang giải mã dữ liệu hội thoại.', step: 3, progress: 83 });
      await decodeBackupWithZalo({ inputPath, outputPath, key, zaloDirectory,
        conversationCount: backupInfo.totalThreads,
        onProgress: event => this.onSyncStatus({ phase: 'decrypting_backup',
          title: 'Đang giải mã bản sao lưu',
          message: `Đã xử lý ${event.progress} hội thoại trong bản sao lưu.`,
          step: 3, progress: 85 }) });

      this.onSyncStatus({ phase: 'importing_backup', title: 'Đang nhập tin nhắn',
        message: 'Đang lưu toàn bộ hội thoại đã giải mã vào cơ sở dữ liệu.', step: 3, progress: 90 });
      const result = await importDecryptedBackup({ folder: outputPath, store: this.messageStore,
        accountId: backupInfo.plainUserId || String(ctx.uid),
        parseBinNetBatch: items => parseBackupMediaWithZalo({ items, zaloDirectory }),
        resolveThread: (threadId, isGroup) => {
          if (isGroup) {
            const group = this.cachedGroups?.[threadId] || this.cachedGroups?.[`g_${threadId}`];
            return { name: group?.name || '', avatar: group?.avatar || '' };
          }
          const friend = this.cachedFriends?.find(item => String(item.userId) === threadId);
          return { name: friend?.displayName || friend?.zaloName || '', avatar: friend?.avatar || '' };
        },
        onProgress: progress => {
          if (progress.conversations % 25 === 0) this.onSyncStatus({ phase: 'importing_backup',
            title: 'Đang nhập tin nhắn',
            message: `Đã đọc ${progress.conversations} hội thoại và ${progress.imported} tin nhắn.`,
            step: 3, progress: 93 });
        } });
      if (backupInfo.totalMsgs > 0 && result.imported === 0) {
        throw new Error('Bản sao lưu có tin nhắn nhưng chưa nhập được bản ghi nào');
      }
      this.messagesHistory = this.messageStore.getRecent(MAX_LOCAL_MESSAGES);
      this.resolveBackupThreadIdentities().catch(error => console.warn('Chưa khôi phục được tên hội thoại:', error.message));
      return result;
    } finally {
      const resolved = path.resolve(workRoot);
      if (resolved.startsWith(tempBase + path.sep) && path.basename(resolved).startsWith('nhitzalo-zalo-backup-')) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }

  // Kết thúc chu trình đồng bộ từ điện thoại khi đã nhận metadata sao lưu.
  async finishPhoneSync() {
    if (!this.phoneSyncState?.active || this.phoneSyncState.isFinished) return;
    if (!this.phoneSyncState.isPreparing) {
      this.failPhoneSync('Chưa nhận được xác nhận đồng bộ từ điện thoại.');
      return;
    }
    this.phoneSyncState.isFinished = true;
    if (this.phoneSyncTimeout) clearTimeout(this.phoneSyncTimeout);
    this.phoneSyncTimeout = null;
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = null;

    const backupInfo = this.phoneSyncBackupInfo || {};
    const deviceName = backupInfo.deviceName || 'Điện thoại Zalo';
    this.onSyncStatus({
      phase: 'finalizing',
      title: 'Điện thoại đã chuẩn bị bản sao lưu',
      message: `Đang kiểm tra tin nhắn đã khả dụng qua kết nối Zalo. Bản sao lưu từ ${deviceName} chưa được nhập.`,
      step: 3,
      progress: 85
    });

    try {
      let importedBackup = null;
      let backupError = null;
      if (backupInfo.url && backupInfo.encryptedKey) {
        try {
          importedBackup = await this.importPhoneBackup(backupInfo);
        } catch (error) {
          backupError = error;
          console.warn('Không thể nhập bản sao lưu điện thoại:', error.message);
        }
      }

      if (importedBackup) {
        // Lấy thêm những tin đến sau thời điểm điện thoại chụp bản sao lưu.
        try { await this.scanOldMessages(2); } catch (scanError) {
          console.warn('Không thể tải phần tin mới sau bản sao lưu:', scanError.message);
        }
        this.flushMessagesHistory();
        this.messagesHistory = this.messageStore.getRecent(MAX_LOCAL_MESSAGES);
        const total = this.messageStore.getStats().totalMessages;
        this.phoneSyncState.active = false;
        this.isSyncing = false;
        this.lastSyncTime = Date.now();
        this.onSyncStatus({ phase: 'completed', title: 'Đã nhập bản sao lưu điện thoại',
          message: `Đã nhập ${importedBackup.imported} tin nhắn từ ${importedBackup.conversations} hội thoại; hiện có ${total} tin trong ứng dụng.`,
          step: 3, progress: 100, total, imported: importedBackup.imported,
          added: Math.max(0, total - (this.phoneSyncState.beforeCount || 0)),
          conversations: importedBackup.conversations });
        return;
      }

      // Nếu bản sao lưu không nhập được, chỉ báo số tin lấy được qua kết nối Zalo.
      try {
        await this.scanAllAvailableMessages();
      } catch (scanErr) {
        console.warn('Cảnh báo scanOldMessages trong finishPhoneSync:', scanErr.message);
      }

      // 2. Đồng bộ các nhóm gần đây từ Cloud Message Store
      try {
        await this.syncRecentGroupsHistory(15);
      } catch (grpErr) {
        console.warn('Cảnh báo syncRecentGroupsHistory trong finishPhoneSync:', grpErr.message);
      }

      this.flushMessagesHistory();
      const total = this.messageStore.getStats().totalMessages;
      const added = Math.max(0, total - (this.phoneSyncState.beforeCount || 0));

      if (added === 0) {
        const reason = backupError ? ` ${backupError.message}` : '';
        this.failPhoneSync(`Điện thoại ${deviceName} đã tạo bản sao lưu, nhưng ứng dụng chưa nhập được tin nhắn từ bản sao lưu đó.${reason}`, 'failed');
        return;
      }
      this.phoneSyncState.active = false;
      this.isSyncing = false;
      this.lastSyncTime = Date.now();
      this.onSyncStatus({
        phase: 'partial',
        title: 'Đồng bộ điện thoại chưa hoàn tất',
        message: `Bản sao lưu từ ${deviceName} chưa nhập được${backupError ? `: ${backupError.message}` : '.'} Đã lưu thêm ${added} tin nhắn gần đây qua kết nối Zalo.`,
        step: 3,
        progress: 0,
        total,
        added
      });

    } catch (error) {
      console.error('Lỗi trong finishPhoneSync:', error);
      this.failPhoneSync(`Không thể kiểm tra lịch sử sau khi điện thoại tạo bản sao lưu: ${error.message}`);
    }
  }

  // Lấy tin nhắn thực tế của Nhóm từ Cloud Message Store (Zalo Cloud)
  async fetchGroupMessages(groupId, count = 50) {
    if (!this.api || !groupId) return [];
    try {
      const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
      const utils = require(utilsPath);
      const ctx = this.api.getContext();
      const host = this.api.zpwServiceMap?.group_cloud_message?.[0];
      if (!host) {
        console.warn('Không tìm thấy group_cloud_message host trong zpwServiceMap');
        return [];
      }

      const gid = String(groupId).replace(/^g_?/, '');
      const url = `${host}/api/cm/getrecentv2`;
      const params = {
        groupId: gid,
        globalMsgId: '9223372036854775808',
        count: Math.min(count, 50),
        msgIds: [],
        imei: ctx.imei,
        src: 1
      };

      const enc = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
      const serviceURL = utils.makeURL(ctx, url, { params: enc, nretry: 0 });
      const resp = await utils.request(ctx, serviceURL, { method: 'GET' });
      const json = await resp.json();

      let groupMsgs = [];
      if (json && json.data) {
        const decoded = utils.decodeAES(ctx.secretKey, json.data);
        const outer = JSON.parse(decoded);
        let innerData = outer?.data;
        if (typeof innerData === 'string') {
          try {
            innerData = JSON.parse(innerData);
          } catch (e) {}
        }
        if (innerData && Array.isArray(innerData.groupMsgs)) {
          groupMsgs = innerData.groupMsgs;
        }
      }

      const formattedList = [];
      for (const rawMsg of groupMsgs) {
        if (!rawMsg || !rawMsg.content) continue;
        const msgObj = {
          threadId: gid,
          type: 1, // ThreadType.Group
          isSelf: String(rawMsg.uidFrom) === String(ctx.uid) || rawMsg.uidFrom === '0',
          data: rawMsg
        };
        const formatted = this.formatMessage(msgObj);
        if (formatted) {
          this.addMessageToHistory(formatted);
          this.onNewMessage(formatted, true);
          formattedList.push(formatted);
        }
      }

      return formattedList;
    } catch (e) {
      console.warn(`Lỗi khi fetchGroupMessages cho nhóm ${groupId}:`, e.message);
      return [];
    }
  }

  // Đồng bộ tin nhắn của các nhóm gần đây từ Cloud Message Store
  async syncRecentGroupsHistory(maxGroups = 50) {
    if (!this.cachedGroups) return 0;
    const groupList = Object.values(this.cachedGroups);
    if (groupList.length === 0) return 0;

    console.log(`Bắt đầu đồng bộ tin nhắn Cloud từ ${Math.min(groupList.length, maxGroups)} nhóm Zalo...`);
    let totalNew = 0;
    const targetGroups = groupList.slice(0, maxGroups);

    for (const grp of targetGroups) {
      try {
        const msgs = await this.fetchGroupMessages(grp.groupId, 30);
        totalNew += msgs.length;
        // Delay 120ms để không bị Zalo rate limit
        await new Promise(r => setTimeout(r, 120));
      } catch (err) {}
    }

    console.log(`Đã hoàn tất đồng bộ Cloud nhóm: nạp thêm ${totalNew} tin nhắn.`);
    return totalNew;
  }

  // Lấy tin nhắn cho 1 thread cụ thể khi người dùng chọn hội thoại (Trả về tức thì, không gây đơ)
  async fetchThreadMessages(threadId, isGroup = false) {
    if (!threadId) return [];
    if (String(threadId) === this.getMyCloudId()) {
      return (await this.fetchCloudMessages()).messages;
    }
    if (isGroup) {
      return await this.fetchGroupMessages(threadId, 50);
    } else {
      // Tin nhắn cá nhân: lấy ngay từ bộ nhớ cục bộ, không quét socket chặn UI gây đơ
      const existing = this.messagesHistory.filter(m => String(m.threadId) === String(threadId) || String(m.senderId) === String(threadId));
      if (existing.length === 0) {
        // Chỉ quét nhẹ 1 trang socket nếu hoàn toàn chưa có tin nhắn nào
        const timeSinceLastScan = Date.now() - (this.lastOldScanTime || 0);
        if (timeSinceLastScan > 30000) {
          await this.scanOldMessages(1);
        }
      }
      return this.messagesHistory.filter(m => String(m.threadId) === String(threadId) || String(m.senderId) === String(threadId));
    }
  }

  // Nạp danh bạ bạn bè và nhóm vào bộ nhớ đệm (dùng để tra cứu Avatar và Tên người gửi thật)
  async preloadContacts() {
    if (!this.api) return;

    // 1. Nạp danh bạ bạn bè (nếu chưa có cache hoặc cache quá 5 phút)
    if (!this.cachedFriends || (Date.now() - this.cachedFriendsTime > 5 * 60 * 1000)) {
      try {
        if (this.api.getAllFriends) {
          const friends = await this.api.getAllFriends(100, 1);
          const list = Array.isArray(friends) ? friends : [];
          if (list.length > 0) {
            this.cachedFriends = list;
            this.cachedFriendsTime = Date.now();
          }
        }
      } catch (err) {
        if (!err.message || !err.message.includes('429')) {
          console.warn('Lỗi nạp danh bạ bạn bè:', err.message);
        }
      }
    }

    // Delay 300ms tránh spam API
    await new Promise(r => setTimeout(r, 300));

    // 2. Nạp thông tin nhóm Zalo (nếu chưa có cache hoặc cache quá 10 phút)
    if (!this.cachedGroups || Object.keys(this.cachedGroups).length === 0 || (Date.now() - this.cachedGroupsTime > 10 * 60 * 1000)) {
      await this.fetchGroupsList().catch(e => console.warn('Lỗi preload groups:', e.message));
    }
  }

  // Gửi yêu cầu đồng bộ tin nhắn qua điện thoại (Hiển thị popup xác nhận trên điện thoại Zalo)
  async requestSyncFromMobile() {
    if (!this.api) return { success: false, error: 'Chưa kết nối tài khoản Zalo' };

    try {
      this.phoneSyncBackupInfo = null;
      const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
      const utils = this.syncRequestUtils || require(utilsPath);
      const ctx = this.api.getContext();
      const os = require('os');
      const pcName = os.hostname() || 'Zalo PC';

      // Reset trạng thái đồng bộ điện thoại
      this.phoneSyncState = {
        active: true,
        isWaiting: true,
        isPreparing: false,
        isFinished: false,
        sawLastPacket: false,
        packetsReceived: 0,
        beforeCount: this.messageStore.getStats().totalMessages,
        startTime: Date.now(),
        lastPacketTime: null
      };

      // Đảm bảo listener WebSocket đang chạy để nhận phản hồi từ điện thoại
      if (this.listener) {
        try {
          this.listener.start({ retryOnClose: true });
        } catch (_) {}
      }

      // Tạo cặp khóa RSA 2048-bit để mã hóa đầu cuối với điện thoại (chuẩn Zalo PC)
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.syncPrivateKey = privateKey;
      const publicKeyBase64 = publicKey
        .toString()
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\s+/g, '');
      this.syncPublicKey = publicKeyBase64;

      // Gửi yêu cầu trước, rồi mới đánh thức điện thoại khi máy chủ đã chấp nhận.
      const fileBase = this.api.zpwServiceMap.file[0];
      const baseURL = fileBase + '/api/message/pull_mobile_msg';

      const params = {
        pc_name: pcName,
        public_key: publicKeyBase64,
        from_seq_id: 0,
        is_retry: 0,
        min_seq_id: 0,
        temp_key: '',
        imei: ctx.imei,
      };

      console.log(`📱 [Sync] Đang gửi pull_mobile_msg với tên máy [${pcName}] tới máy chủ Zalo...`);
      const encryptedParams = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
      const serviceURL = utils.makeURL(ctx, baseURL, {
        params: encryptedParams,
        nretry: 0
      }, true);

      const response = await utils.request(ctx, serviceURL, { method: 'GET' });
      const result = await response.json();
      if (result && (result.error_code === 0 || result.error_code === '0')) {
        if (typeof this.listener?.requestMobileWakeUp === 'function') {
          try { this.listener.requestMobileWakeUp(); }
          catch (wsErr) { console.warn('Không thể đánh thức Zalo điện thoại:', wsErr.message); }
        }
        return {
          success: true,
          message: 'Máy chủ Zalo đã chấp nhận yêu cầu; đang chờ điện thoại phản hồi.'
        };
      }
      this.phoneSyncState.active = false;
      return { success: false, error: result?.error_message || 'Không thể gửi yêu cầu đến điện thoại' };
    } catch (e) {
      this.phoneSyncState.active = false;
      console.warn('Lỗi khi gọi requestSyncFromMobile:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Lấy thống kê lịch sử đồng bộ tin nhắn
  getSyncStatus() {
    let fileSize = 0;
    try {
      if (fs.existsSync(this.messageStore.dbPath)) {
        fileSize = fs.statSync(this.messageStore.dbPath).size;
      }
    } catch (e) {}
    const stats = this.messageStore.getStats();

    return {
      totalMessages: stats.totalMessages,
      totalConversations: stats.totalConversations,
      totalGroups: Object.keys(this.cachedGroups || {}).length,
      totalFriends: (this.cachedFriends || []).length,
      isListenerConnected: !!(this.listener && this.listener.ws && this.listener.ws.readyState === 1),
      lastSyncTime: this.lastSyncTime || null,
      lastRecentCheckTime: this.lastRecentCheckTime || null,
      lastRecentAdded: this.lastRecentAdded || 0,
      myCloudId: this.getMyCloudId(),
      storageFilePath: this.messageStore.dbPath,
      fileSize: fileSize
    };
  }

  getMyCloudId() {
    const id = String(this.api?.getContext?.()?.loginInfo?.send2me_id || '');
    return /^\d{7,25}$/.test(id) ? id : '';
  }

  async requestCloudPage(endpoint, params) {
    const utilsPath = path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs');
    const utils = require(utilsPath);
    const ctx = this.api.getContext();
    const host = this.api.zpwServiceMap?.group_cloud_message?.[0];
    if (!host) throw new Error('Phiên Zalo không có dịch vụ Cloud Message');
    const encrypted = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
    if (!encrypted) throw new Error('Không mã hóa được yêu cầu Cloud');
    const url = utils.makeURL(ctx, `${host}${endpoint}`, { params: encrypted, nretry: 0 });
    const response = await utils.request(ctx, url, { method: 'GET' });
    if (!response.ok) throw new Error(`Không tải được Cloud của tôi (HTTP ${response.status})`);
    const json = await response.json();
    if (Number(json?.error_code || 0) !== 0) {
      const error = new Error(`Cloud Zalo trả về mã ${json.error_code}: ${json.error_message || 'Lỗi không rõ'}`);
      error.code = Number(json.error_code);
      throw error;
    }
    if (!json?.data) return { groupMsgs: [], hasMore: false };
    const decoded = utils.decodeAES(ctx.secretKey, json.data);
    const outer = JSON.parse(decoded);
    const inner = typeof outer.data === 'string' ? JSON.parse(outer.data) : outer.data;
    return inner || {};
  }

  async fetchCloudMessages(cursor = '0', older = false) {
    const cloudId = this.getMyCloudId();
    if (!cloudId) throw new Error('Chưa nhận được ID Cloud của tôi từ phiên Zalo');
    if (Date.now() < (this.cloudRetryAfter || 0)) {
      throw new Error('Cloud Zalo đang giới hạn yêu cầu. Vui lòng thử lại sau ít phút.');
    }
    const ctx = this.api.getContext();
    const endpoint = older ? '/api/cm/getoldv2' : '/api/cm/getrecentv2';
    const params = { groupId: cloudId, globalMsgId: String(cursor || '0'), count: 50,
      msgIds: [], imei: ctx.imei, isOA: 1, src: -1 };
    let page;
    try {
      page = await this.requestCloudPage(endpoint, params);
    } catch (error) {
      if (Number(error.code) === -69) {
        this.cloudRetryAfter = Date.now() + 15 * 60_000;
        throw new Error('Cloud Zalo đang giới hạn yêu cầu. Vui lòng thử lại sau ít phút.');
      }
      throw error;
    }
    const rawMessages = Array.isArray(page.groupMsgs) ? page.groupMsgs : [];
    const newMessages = [];
    for (const raw of rawMessages) {
      const normalized = this.formatMessage({ type: 0, threadId: cloudId,
        isSelf: String(raw.uidFrom || '') === '0' || String(raw.uidFrom || '') === String(ctx.uid), data: raw });
      if (!normalized) continue;
      normalized.threadId = cloudId;
      normalized.threadName = 'Cloud của tôi';
      normalized.isGroup = false;
      if (this.messageStore.hasMessage(cloudId, normalized.id, normalized.cliMsgId, false)) continue;
      newMessages.push(normalized);
    }
    if (newMessages.length) {
      this.messageStore.putMany(newMessages);
      this.messagesHistory = [...newMessages, ...this.messagesHistory]
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, MAX_LOCAL_MESSAGES);
      for (const message of newMessages) this.onNewMessage(message, true);
    }
    return { messages: newMessages, hasMore: Boolean(page.hasMore ?? rawMessages.length === 50),
      lastMsgId: String(page.lastMsgId || rawMessages.at(-1)?.msgId || '') };
  }

  // Đồng bộ nhanh từ các trang lịch sử WebSocket khả dụng.
  async quickSyncMessages() {
    return this.syncSocketHistory();
  }

  // Tải lịch sử cá nhân và nhóm qua WebSocket do zalo-api-final hỗ trợ.
  async syncSocketHistory(maxPages = null) {
    if (!this.api) {
      return {
        success: false,
        error: 'Chưa đăng nhập tài khoản Zalo. Vui lòng quét mã QR để kết nối!'
      };
    }

    if (this.isSyncing) return { success: false, error: 'Đang đồng bộ tin nhắn, vui lòng đợi.' };
    this.isSyncing = true;
    try {
      if (this.recentCatchupPromise) await this.recentCatchupPromise;
      if (!this.listener) this.initListener();
      if (!this.listener?.requestOldMessages) throw new Error('Thư viện Zalo không hỗ trợ tải lịch sử tin nhắn');
      if (this.listener.ws?.readyState !== 1) {
        try { this.listener.start({ retryOnClose: true }); } catch (_) {}
        for (let i = 0; i < 10 && this.listener.ws?.readyState !== 1; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      if (this.listener.ws?.readyState !== 1) throw new Error('WebSocket Zalo chưa kết nối; vui lòng thử lại khi kết nối ổn định');

      const before = this.messageStore.getStats().totalMessages;
      this.onSyncStatus({ phase: 'scanning', title: 'Đang tải lịch sử tin nhắn',
        message: 'Đang tải các trang tin nhắn cá nhân và nhóm từ kết nối Zalo.', step: 2, progress: 40 });
      const received = maxPages == null
        ? await this.scanAllAvailableMessages()
        : await this.scanOldMessages(maxPages);
      this.flushMessagesHistory();
      const total = this.messageStore.getStats().totalMessages;
      const added = Math.max(0, total - before);
      this.lastSyncTime = Date.now();
      const message = `Đã lưu thêm ${added} tin nhắn; hiện có ${total} tin nhắn cục bộ. Lịch sử từ điện thoại chưa được nhập.`;
      this.onSyncStatus({ phase: 'completed', title: 'Đã tải lịch sử khả dụng', message,
        step: 3, progress: 100, total, added, received });
      return { success: true, count: total, added, received, message, timestamp: this.lastSyncTime };
    } catch (error) {
      this.onSyncStatus({ phase: 'failed', title: 'Không thể đồng bộ tin nhắn', message: error.message,
        step: 1, progress: 0, error: error.message });
      return { success: false, error: error.message };
    } finally {
      this.isSyncing = false;
    }
  }

  // Yêu cầu điện thoại xác nhận đồng bộ; chưa coi việc gửi yêu cầu là đã nhập lịch sử.
  async syncOldMessages() {
    if (!this.api) return { success: false, error: 'Chưa đăng nhập tài khoản Zalo' };
    if (this.isSyncing) return { success: false, error: 'Đang đồng bộ tin nhắn, vui lòng đợi.' };
    this.isSyncing = true;
    try {
      if (this.recentCatchupPromise) await this.recentCatchupPromise;
      if (!this.listener) this.initListener();
      if (this.listener?.ws?.readyState !== 1) {
        try { this.listener?.start({ retryOnClose: true }); } catch (_) {}
        for (let i = 0; i < 20 && this.listener?.ws?.readyState !== 1; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      if (this.listener?.ws?.readyState !== 1) throw new Error('WebSocket Zalo chưa kết nối; chưa gửi yêu cầu tới điện thoại');
      this.onSyncStatus({ phase: 'requesting_phone', title: 'Đang gửi yêu cầu tới điện thoại',
        message: 'Đang chờ máy chủ Zalo chấp nhận yêu cầu đồng bộ.', step: 1, progress: 10 });
      this.phoneSyncState = { active: true, isWaiting: true, isPreparing: false,
        isFinished: false, sawLastPacket: false, packetsReceived: 0,
        beforeCount: this.messageStore.getStats().totalMessages,
        startTime: Date.now(), lastPacketTime: null };
      const result = await this.requestSyncFromMobile();
      if (!result?.success) throw new Error(result?.error || 'Máy chủ Zalo từ chối yêu cầu đồng bộ');
      if (this.phoneSyncState.isWaiting) {
        this.phoneSyncTimeout = setTimeout(() => {
          if (this.phoneSyncState?.active && this.phoneSyncState.isWaiting) {
            this.failPhoneSync('Không nhận được xác nhận từ điện thoại trong 90 giây. Hãy mở Zalo trên điện thoại và thử lại.');
          }
        }, 90000);
        this.phoneSyncTimeout.unref?.();
        this.onSyncStatus({ phase: 'waiting_phone', title: 'Máy chủ đã nhận yêu cầu',
          message: 'Đang chờ điện thoại nhận thông báo. Hãy mở Zalo trên điện thoại.', step: 1, progress: 20 });
      }
      return { success: false, requestAccepted: true, waitingPhone: this.phoneSyncState.isWaiting, completed: false,
        message: 'Máy chủ đã nhận yêu cầu; đang chờ điện thoại phản hồi.' };
    } catch (error) {
      this.failPhoneSync(error.message);
      return { success: false, error: error.message };
    }
  }

  failPhoneSync(message, phase = 'failed') {
    if (this.phoneSyncTimeout) clearTimeout(this.phoneSyncTimeout);
    this.phoneSyncTimeout = null;
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.syncDebounceTimer = null;
    if (this.phoneSyncState) this.phoneSyncState.active = false;
    this.isSyncing = false;
    this.onSyncStatus({ phase, title: 'Đồng bộ điện thoại chưa hoàn tất', message,
      step: 1, progress: 0, error: message });
  }

  // Chuẩn hóa tin nhắn (cả mới và cũ)
  formatMessage(message) {
    try {
      const isGroup = message.type === 1; // ThreadType.Group = 1, User = 0
      const data = message.data || {};

      const msgType = String(data.msgType || message.msgType || '');
      let isPhoto = false;
      let photoUrl = '';
      let thumbUrl = '';
      let isSticker = false;
      let stickerUrl = '';
      let isVideo = false;
      let videoUrl = '';
      let voiceUrl = '';
      let m4aUrl = '';

      let isFile = false;
      let fileName = '';
      let fileUrl = '';
      let fileSize = 0;
      let isLink = false;
      let linkUrl = '';
      let linkPreview = null;

      // 1. Nhận diện tin nhắn bị thu hồi (kể cả người khác thu hồi hoặc mình thu hồi)
      let isUndo = Boolean(
        message.isUndo ||
        message.isRevoked ||
        message.isRecalled ||
        msgType === 'chat.undo' ||
        msgType === 'chat.delete.everyone' ||
        msgType === 'chat.delete' ||
        data.msgType === 'chat.undo' ||
        data.originMsgType === 'chat.undo' ||
        (data.content && typeof data.content === 'object' && ('deleteMsg' in data.content || data.content.act === 'undo' || data.content.action === 'undo')) ||
        (typeof data.content === 'string' && (
          data.content === '[Tin nhắn đã bị xóa]' || 
          data.content === 'Tin nhắn đã được thu hồi' || 
          data.content.includes('Tin nhắn đã được thu hồi') ||
          data.content.includes('Tin nhắn đã bị thu hồi') ||
          data.content.includes('đã thu hồi một tin nhắn')
        ))
      );

      let contentText = '';
      if (isUndo) {
        contentText = 'Tin nhắn đã được thu hồi';
      } else if (typeof data.content === 'string') {
        contentText = data.content;
        // Kiểm tra xem tin nhắn có chứa mã nhãn dán Zalo dạng [^cateId.stickerId^]
        const stkShortcodeMatch = contentText.match(/\[\^(\d+)\.(\d+)\^\]/);
        if (stkShortcodeMatch) {
          isSticker = true;
          const stkId = stkShortcodeMatch[2];
          stickerUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stkId}&size=260`;
          contentText = '[Nhãn dán Sticker]';
        }
        // Kiểm tra xem chuỗi content có phải là link ảnh trực tiếp
        else if (contentText.match(/^https?:\/\/[^\s]+(\.(jpg|jpeg|png|webp|gif)|\/jpg\/|\/png\/)/i) || contentText.includes('.zdn.vn/')) {
          isPhoto = true;
          photoUrl = contentText;
          thumbUrl = contentText;
        } else if (contentText.match(/^https?:\/\/[^\s]+(\.mp4|\.mov|video-stal|dlmd\.me)/i)) {
          isVideo = true;
          videoUrl = contentText;
        } else if (contentText.match(/^https?:\/\/[^\s]+(\.(pdf|docx|xlsx|pptx|zip|rar|7z|txt|csv|tar|gz))/i)) {
          isFile = true;
          fileUrl = contentText;
          fileName = contentText.split('/').pop().split('?')[0] || 'Tài liệu';
          contentText = `[Tài liệu: ${fileName}]`;
        } else if (contentText.match(/https?:\/\/[^\s]+/i)) {
          isLink = true;
          const matchUrl = contentText.match(/https?:\/\/[^\s]+/i);
          linkUrl = matchUrl ? matchUrl[0] : '';
        }
      } else if (data.content && typeof data.content === 'object') {
        // 2. Nhận diện tệp tin (File) đính kèm Zalo dạng Object
        const isFileObject = msgType === 'share.file' ||
                             data.msgType === 'share.file' ||
                             Boolean(data.content.params && typeof data.content.params === 'string' && (data.content.params.includes('fileSize') || data.content.params.includes('fileExt'))) ||
                             Boolean(data.content.file_name || data.content.name || data.content.file_size || data.content.size || data.content.fileExt);

        if (data.content.id && (data.content.catId || data.content.cateId)) {
          isSticker = true;
          const stickerId = data.content.id;
          stickerUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stickerId}&size=260`;
          contentText = '[Nhãn dán Sticker]';
        } else if (msgType === 'chat.photo') {
          isPhoto = true;
          photoUrl = data.content.href || data.content.url || data.url || '';
          thumbUrl = data.content.thumb || data.content.thumbUrl || data.thumb || photoUrl;
          contentText = '[Hình ảnh]';
        } else if (isFileObject) {
          isFile = true;
          let pObj = {};
          if (typeof data.content.params === 'string') {
            try { pObj = JSON.parse(data.content.params); } catch (e) {}
          } else if (data.content.params && typeof data.content.params === 'object') {
            pObj = data.content.params;
          }

          // Ưu tiên data.content.title (như "tháng 10.zip") hoặc file_name / name
          fileName = data.content.title || data.content.file_name || data.content.name || pObj.fileName || pObj.name || '';
          if (!fileName && data.content.href) {
            const rawPart = data.content.href.split('/').pop().split('?')[0];
            if (rawPart && rawPart.includes('.')) fileName = decodeURIComponent(rawPart);
          }
          if (!fileName) fileName = 'Tài liệu Zalo';

          fileUrl = data.content.href || data.content.url || '';
          fileSize = Number(data.content.file_size || data.content.size || pObj.fileSize || pObj.size || 0);
          contentText = `[Tài liệu: ${fileName}]`;
        } else if (data.content.href && (data.content.href.match(/\.(jpg|jpeg|png|webp|gif)/i) || data.content.href.includes('zdn.vn'))) {
          isPhoto = true;
          photoUrl = data.content.href;
          thumbUrl = data.content.thumb || data.content.thumbUrl || photoUrl;
          contentText = '[Hình ảnh]';
        } else if (data.content.href && (data.content.href.match(/\.(mp4|mov)/i) || data.content.href.includes('video-stal') || data.content.href.includes('dlmd.me'))) {
          isVideo = true;
          videoUrl = data.content.href;
          contentText = '[Video]';
        } else if (data.content.title || data.content.description) {
          // Kiểm tra nếu title có đuôi file (ví dụ: "tháng 10.zip", "abc.docx", "xyz.xlsx")
          const titleStr = String(data.content.title || '');
          if (titleStr.match(/\.(pdf|docx|doc|xlsx|xls|pptx|zip|rar|7z|txt|csv|tar|gz|mp4|apk|ipa)$/i)) {
            isFile = true;
            fileName = titleStr;
            fileUrl = data.content.href || '';
            contentText = `[Tài liệu: ${fileName}]`;
          } else {
            contentText = [data.content.title, data.content.description].filter(Boolean).join(' - ');
            if (data.content.href) {
              isLink = true;
              linkUrl = data.content.href;
            }
          }
        } else if (data.content.href) {
          contentText = data.content.href;
          isLink = true;
          linkUrl = data.content.href;
        } else {
          contentText = '[Hình ảnh / Đa phương tiện]';
        }
      }

      if (msgType === 'chat.sticker' && !isSticker && data.content?.id) {
        isSticker = true;
        stickerUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${data.content.id}&size=260`;
        contentText = '[Nhãn dán Sticker]';
      } else if (msgType === 'chat.photo') {
        isPhoto = true;
        if (!photoUrl && data.url) photoUrl = data.url;
        if (!thumbUrl && data.thumb) thumbUrl = data.thumb;
      } else if (msgType === 'share.file' && !isFile) {
        isFile = true;
        let pObj = {};
        if (typeof data.content?.params === 'string') {
          try { pObj = JSON.parse(data.content.params); } catch (e) {}
        }
        fileName = data.content?.title || data.content?.file_name || data.content?.name || pObj.fileName || 'Tài liệu Zalo';
        fileUrl = data.content?.href || data.content?.url || '';
        fileSize = Number(data.content?.file_size || data.content?.size || pObj.fileSize || 0);
        contentText = `[Tài liệu: ${fileName}]`;
      }

      if (msgType === 'chat.voice') {
        const voice = data.content && typeof data.content === 'object' ? data.content : {};
        let params = voice.params || {};
        if (typeof params === 'string') {
          try { params = JSON.parse(params); } catch (_) { params = {}; }
        }
        voiceUrl = String(voice.href || voice.voiceUrl || data.voiceUrl ||
          (typeof data.content === 'string' && data.content.startsWith('https://') ? data.content : '') || '');
        m4aUrl = String(params.m4a || voice.m4aUrl || data.m4aUrl || '');
        contentText = '[Tin nhắn thoại]';
        isPhoto = false;
        isVideo = false;
        isFile = false;
        isLink = false;
      }

      const photoCaption = isPhoto ? extractPhotoCaption(data) : '';

      if (isLink && data.content && typeof data.content === 'object') {
        const rich = data.content;
        const preview = {
          title: String(rich.title || rich.name || ''),
          description: String(rich.description || rich.desc || ''),
          image: String(rich.thumb || rich.thumbUrl || rich.image || rich.imageUrl || '')
        };
        if (Object.values(preview).some(Boolean)) linkPreview = preview;
      }

      const myUid = String(this.currentUser?.userId || (this.api?.getContext ? this.api.getContext()?.uid : '') || '');
      const uidFrom = String(data.uidFrom || '');
      const idTo = String(data.idTo || '');

      // Xác định chính xác tin nhắn do chính mình gửi đi:
      const isSelf = Boolean(
        message.isSelf ||
        uidFrom === '0' ||
        (myUid && uidFrom === myUid) ||
        data.dName === 'Bạn (Tôi)'
      );

      contentText = describeCallMessage({ content: contentText, isSelf, msgType,
        callStatus: data.callStatus || data.content?.callStatus,
        status: data.status || data.content?.status,
        callType: data.callType || data.content?.callType });

      // Xử lý tên người gửi bubble
      let senderName = data.dName || '';
      if (isSelf) {
        senderName = 'Bạn (Tôi)';
      }

      // Xác định threadId và partnerId (đối tác trong cuộc trò chuyện)
      let threadId = String(message.threadId || '');
      let partnerId = '';

      if (isGroup) {
        threadId = String(message.threadId || data.grid || '');
      } else {
        if (isSelf) {
          partnerId = (idTo && idTo !== '0' && idTo !== myUid) ? idTo : threadId;
          threadId = partnerId;
        } else {
          partnerId = uidFrom || threadId;
          threadId = partnerId;
        }
      }

      const senderId = isSelf ? (myUid || 'me') : (uidFrom || threadId);

      // Tra cứu Avatar và Tên hiển thị của thread và người gửi
      let threadName = '';
      let threadAvatar = '';
      let senderAvatar = isSelf ? (this.currentUser?.avatar || '') : '';

      if (isGroup) {
        const cleanGid = threadId.replace(/^g_/, '');
        const grp = this.cachedGroups ? (this.cachedGroups[threadId] || this.cachedGroups[cleanGid] || this.cachedGroups['g_' + cleanGid]) : null;
        if (grp) {
          threadAvatar = grp.avatar || '';
          threadName = grp.name || 'Nhóm Zalo';
        }
        if (!threadName) threadName = data.dName || 'Nhóm Zalo';
        if (!senderName) senderName = 'Thành viên nhóm';

        // Lấy avatar của người gửi tin nhắn lẻ trong nhóm
        if (!isSelf) {
          let memberFriend = null;
          if (Array.isArray(this.cachedFriends) && uidFrom) {
            memberFriend = this.cachedFriends.find(f => String(f.userId) === String(uidFrom));
          }
          senderAvatar = data.avatar || data.avt || data.thumb || (memberFriend ? memberFriend.avatar : '') || '';
        }
      } else {
        // Cuộc trò chuyện cá nhân: tra cứu từ cachedFriends
        let friend = null;
        if (Array.isArray(this.cachedFriends)) {
          friend = this.cachedFriends.find(f => String(f.userId) === String(partnerId));
        }

        if (friend) {
          threadName = friend.displayName || friend.zaloName;
          threadAvatar = friend.avatar || '';
        } else {
          threadName = !isSelf ? (data.dName || 'Bạn bè Zalo') : (message.threadName || 'Bạn bè Zalo');
          threadAvatar = !isSelf ? (data.avatar || data.avt || '') : (message.threadAvatar || '');
        }

        if (!isSelf) {
          if (!senderName || senderName === 'Bạn bè Zalo') {
            senderName = threadName || 'Bạn bè Zalo';
          }
          if (!senderAvatar) {
            senderAvatar = data.avatar || data.avt || threadAvatar;
          }
        }
      }

      const ts = Number(data.ts) || Date.now();
      const dateObj = new Date(ts);

      // Định dạng ngày giờ: Hôm nay thì hiện giờ, ngày trước thì hiện ngày + giờ
      const isToday = new Date().toDateString() === dateObj.toDateString();
      const timeStr = isToday
        ? dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

      // Giữ lại reactions đã có từ trước hoặc nhận từ payload
      const existingMsg = this.bulkHistoryMode ? null : this.messagesHistory.find(m =>
        (data.msgId && (String(m.id) === String(data.msgId) || String(m.msgId) === String(data.msgId))) ||
        (data.cliMsgId && String(m.cliMsgId) === String(data.cliMsgId))
      );
      let reactions = existingMsg?.reactions ? [...existingMsg.reactions] : [];

      if (Array.isArray(data.reactions) && data.reactions.length > 0) {
        reactions = data.reactions;
      } else if (Array.isArray(message.reactions) && message.reactions.length > 0) {
        reactions = message.reactions;
      } else if (Array.isArray(data.reacts) && data.reacts.length > 0) {
        reactions = data.reacts;
      }

      return {
        id: String(data.msgId || 'msg_' + ts + '_' + Math.random().toString(36).substring(2, 6)),
        cliMsgId: String(data.cliMsgId || ts),
        msgType: msgType,
        senderName: senderName,
        senderId: senderId,
        threadId: threadId,
        threadName: threadName,
        threadAvatar: threadAvatar,
        avatar: senderAvatar,
        content: contentText || '[Tin nhắn]',
        isPhoto: isPhoto,
        photoUrl: photoUrl,
        thumbUrl: thumbUrl || photoUrl,
        photoCaption: photoCaption,
        isSticker: isSticker,
        stickerUrl: stickerUrl,
        isVideo: isVideo,
        videoUrl: videoUrl,
        voiceUrl: voiceUrl,
        m4aUrl: m4aUrl,
        isGroup: isGroup,
        isSelf: isSelf,
        isMuted: this.isThreadMuted(threadId),
        isUndo: isUndo,
        isRevoked: isUndo,
        isRecalled: isUndo,
        isFile: isFile,
        fileName: fileName,
        fileUrl: fileUrl,
        fileSize: fileSize,
        isLink: isLink,
        linkUrl: linkUrl,
        linkPreview: linkPreview,
        reactions: reactions,
        time: timeStr,
        timestamp: ts
      };
    } catch (err) {
      console.error('Lỗi khi định dạng tin nhắn:', err);
      return null;
    }
  }

  // Gửi Nhãn dán / Sticker Zalo
  async sendSticker(threadId, sticker, isGroup = false) {
    if (!this.api || !this.api.sendSticker) {
      throw new Error('Chưa kết nối với Zalo hoặc API không hỗ trợ gửi sticker');
    }
    if (!threadId) throw new Error('Chưa chọn hội thoại nhận sticker');
    const myUid = String(this.currentUser?.userId || (this.api?.getContext ? this.api.getContext()?.uid : '') || '');

    const type = isGroup ? 1 : 0;
    const stickerPayload = {
      id: Number(sticker.id),
      cateId: Number(sticker.cateId || sticker.catId || 10047),
      type: Number(sticker.type || 7)
    };

    console.log(`📤 Đang gửi sticker Zalo (id: ${stickerPayload.id}) tới ${threadId}...`);
    const res = await this.api.sendSticker(stickerPayload, String(threadId), type);

    const ts = Date.now();
    const dateObj = new Date(ts);
    const isToday = new Date().toDateString() === dateObj.toDateString();
    const timeStr = isToday
      ? dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      : `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    const myMsg = {
      id: String(res?.data?.msgId || res?.msgId || ('my_stk_' + ts)),
      cliMsgId: String(ts),
      msgType: 'chat.sticker',
      senderName: 'Bạn (Tôi)',
      senderId: myUid || 'me',
      threadId: String(threadId),
      avatar: this.currentUser?.avatar || '',
      content: '[Nhãn dán Sticker]',
      isSticker: true,
      stickerUrl: `https://api.zaloapp.com/api/emoticon/sticker/webpc?eid=${stickerPayload.id}&size=260`,
      isGroup: isGroup,
      isSelf: true,
      time: timeStr,
      timestamp: ts
    };

    this.addMessageToHistory(myMsg);
    this.onNewMessage(myMsg, false);
    return res;
  }

  // Tìm kiếm sticker theo từ khóa
  async getStickers(keyword) {
    if (!this.api || typeof this.api.getStickers !== 'function') return [];
    try {
      const ids = await this.api.getStickers(keyword);
      return Array.isArray(ids) ? ids : [];
    } catch (e) {
      console.warn('Lỗi getStickers:', e.message);
      return [];
    }
  }

  // Lấy chi tiết sticker theo mảng IDs
  async getStickersDetail(stickerIds) {
    if (!this.api || typeof this.api.getStickersDetail !== 'function') return [];
    try {
      const details = await this.api.getStickersDetail(stickerIds);
      return Array.isArray(details) ? details : [];
    } catch (e) {
      console.warn('Lỗi getStickersDetail:', e.message);
      return [];
    }
  }

  async forwardTextMessage(message, targetThreadId, isGroup = false) {
    if (!this.api || typeof this.api.forwardMessage !== 'function') {
      throw new Error('API Zalo chưa hỗ trợ chuyển tiếp tin nhắn');
    }
    if (!targetThreadId) throw new Error('Chưa chọn hội thoại nhận tin');
    if (message?.isPhoto || message?.isVideo || message?.isFile || message?.isSticker) {
      throw new Error('Ứng dụng chưa hỗ trợ chuyển tiếp media; hãy gửi tệp gốc qua nút đính kèm');
    }
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!content) throw new Error('Tin nhắn không có văn bản để chuyển tiếp');
    const response = await this.api.forwardMessage({ message: content, threadIds: [String(targetThreadId)] }, isGroup ? 1 : 0);
    if (!Array.isArray(response?.success) || response.success.length === 0) {
      throw new Error(response?.failed?.[0]?.errorMessage || 'Chuyển tiếp tin nhắn thất bại');
    }
    return { success: true, response };
  }

  // Trả lời tin nhắn (hỗ trợ văn bản, trích dẫn quote và đính kèm file/ảnh)
  async sendReply(threadId, content, isGroup = false, quote = null, attachments = null) {
    if (!this.api || !this.api.sendMessage) {
      throw new Error('Chưa kết nối với Zalo');
    }
    if (!threadId) throw new Error('Chưa chọn hội thoại nhận tin nhắn');

    const type = isGroup ? 1 : 0;
    const payload = {
      msg: content || ''
    };

    let realQuote = null;
    if (quote) {
      const qMsgId = String(quote.id || quote.msgId || '');
      const isRevoked = quote.isRevoked || (typeof quote.content === 'string' && quote.content.includes('[Tin nhắn đã được thu hồi]'));
      // Server Zalo yêu cầu qmsgId phải là số nguyên numeric ID và không thể quote tin đã thu hồi
      if (/^\d+$/.test(qMsgId) && !isRevoked) {
        let qUidFrom = String(quote.senderId || quote.uidFrom || '0');
        if (qUidFrom === 'me' || !/^\d+$/.test(qUidFrom)) {
          qUidFrom = String(this.currentUser?.userId || '0');
        }
        realQuote = {
          uidFrom: qUidFrom,
          msgId: qMsgId,
          cliMsgId: String(quote.cliMsgId || qMsgId),
          msgType: quote.msgType || 'webchat',
          ts: Number(quote.timestamp || quote.ts) || Date.now(),
          content: quote.content || ''
        };
        payload.quote = realQuote;
      } else {
        console.log(`⚠️ Bỏ qua quote không hợp lệ (msgId: ${qMsgId}) để tránh lỗi tham số không hợp lệ.`);
      }
    }

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments;
    }

    const res = await this.api.sendMessage(
      payload,
      String(threadId),
      type
    );

    const ts = Date.now();
    const dateObj = new Date(ts);
    const isToday = new Date().toDateString() === dateObj.toDateString();
    const timeStr = isToday
      ? dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      : `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

    let displayContent = content || '';
    if (attachments && attachments.length > 0 && !displayContent) {
      displayContent = `[Tệp đính kèm: ${path.basename(attachments[0])}]`;
    }

    const realMsgId = res?.message?.msgId || res?.message?.data?.msgId || res?.data?.msgId;
    const myMsg = {
      id: String(realMsgId || ('self_' + ts + '_' + Math.random().toString(36).substring(2, 6))),
      cliMsgId: String(res?.message?.cliMsgId || ts),
      senderName: 'Bạn (Tôi)',
      senderId: this.currentUser?.userId || 'me',
      threadId: String(threadId),
      avatar: this.currentUser?.avatar || '',
      content: displayContent,
      quote: realQuote ? {
        senderName: quote.senderName || 'Người nhận',
        content: quote.content || ''
      } : null,
      isGroup: !!isGroup,
      isSelf: true,
      time: timeStr,
      timestamp: ts
    };

    this.addMessageToHistory(myMsg);
    this.onNewMessage(myMsg, false);

    return { success: true, message: myMsg };
  }

  // Thả biểu cảm cảm xúc vào tin nhắn (Reaction)
  async sendReaction(threadId, msgId, cliMsgId, icon = '❤️', isGroup = false) {
    if (!this.api || !this.api.addReaction) {
      throw new Error('Chưa kết nối với Zalo');
    }

    const sThreadId = String(threadId || '');
    const cleanThreadId = sThreadId.replace(/^g_/, '');

    // Tìm tin nhắn trong lịch sử bộ nhớ
    const found = this.messagesHistory.find(m =>
      String(m.threadId).replace(/^g_/, '') === cleanThreadId && (
        (msgId && String(m.id) === String(msgId)) ||
        (cliMsgId && String(m.cliMsgId) === String(cliMsgId)) ||
        (msgId && String(m.cliMsgId) === String(msgId))
      )
    );

    const finalIsGroup = Boolean(
      isGroup ||
      (found && found.isGroup) ||
      sThreadId.startsWith('g_') ||
      (this.cachedGroups && this.cachedGroups[cleanThreadId])
    );

    // Lấy msgId thực từ server (nếu là số dài)
    let finalMsgId = '';
    if (found && found.id && /^\d+$/.test(String(found.id)) && String(found.id) !== '0') {
      finalMsgId = String(found.id);
    } else if (msgId && /^\d+$/.test(String(msgId)) && String(msgId) !== '0') {
      finalMsgId = String(msgId);
    }

    // Lấy cliMsgId dạng integer
    let finalCliMsgId = 0;
    if (found && found.cliMsgId && !isNaN(parseInt(found.cliMsgId))) {
      finalCliMsgId = parseInt(found.cliMsgId);
    } else if (cliMsgId && !isNaN(parseInt(cliMsgId))) {
      finalCliMsgId = parseInt(cliMsgId);
    } else if (found && found.timestamp) {
      finalCliMsgId = Number(found.timestamp);
    } else {
      finalCliMsgId = Date.now();
    }

    const finalMsgType = (found && found.msgType && Number(found.msgType)) || 1;

    const dest = {
      type: finalIsGroup ? 1 : 0,
      threadId: cleanThreadId,
      data: {
        msgId: finalMsgId,
        cliMsgId: finalCliMsgId,
        msgType: finalMsgType
      }
    };

    console.log(`❤️ [sendReaction] Thả '${icon}' tới thread=${cleanThreadId} (group=${finalIsGroup}), gMsgID='${finalMsgId}', cMsgID=${finalCliMsgId}`);
    const res = await this.api.addReaction(icon, dest);
    console.log(`❤️ [sendReaction] Kết quả API Zalo:`, res);

    // Cập nhật reaction vào tin nhắn trong lịch sử
    const myUid = this.currentUser?.userId || 'me';
    if (found) {
      if (!found.reactions) found.reactions = [];
      const existingIdx = found.reactions.findIndex(r => r.senderId === myUid);
      if (existingIdx >= 0) {
        found.reactions[existingIdx].icon = icon;
      } else {
        found.reactions.push({
          icon: icon,
          senderId: myUid,
          senderName: 'Bạn (Tôi)'
        });
      }
      this.scheduleSaveMessages();
    }

    // Phát sự kiện cập nhật reaction sang các cửa sổ renderer
    if (typeof this.onReactionUpdate === 'function') {
      this.onReactionUpdate({
        threadId: sThreadId,
        msgId: finalMsgId || msgId,
        cliMsgId: String(finalCliMsgId),
        icon: icon,
        reactions: found?.reactions || [{ icon, senderId: myUid, senderName: 'Bạn (Tôi)' }],
        senderId: myUid,
        senderName: 'Bạn (Tôi)'
      });
    }

    return { success: true, data: res, icon, msgId };
  }

  // Thu hồi tin nhắn đã gửi
  async undoMessage(threadId, msgId, cliMsgId, isGroup = false) {
    if (!this.api || !this.api.undo) {
      throw new Error('Chưa kết nối với Zalo');
    }

    const payload = {
      msgId: String(msgId),
      cliMsgId: String(cliMsgId || msgId)
    };

    const res = await this.api.undo(payload, String(threadId), isGroup ? 1 : 0);

    // Cập nhật trạng thái thu hồi trong bộ nhớ và lưu file
    const found = this.messagesHistory.find(m =>
      String(m.threadId).replace(/^g_/, '') === String(threadId).replace(/^g_/, '') &&
      String(m.id) === String(msgId)
    );
    if (found) {
      found.content = '[Tin nhắn đã được thu hồi]';
      found.isRevoked = true;
      this.saveMessagesHistory();
    }

    return { success: true, data: res, msgId };
  }

  // Ghim hoặc bỏ ghim cuộc hội thoại
  async setPinnedConversation(threadId, isPinned = true, isGroup = false) {
    const sId = String(threadId);
    if (!this.pinnedThreads) this.pinnedThreads = new Set();

    if (this.api && this.api.setPinnedConversations) {
      try {
        await this.api.setPinnedConversations(isPinned, sId, isGroup ? 1 : 0);
      } catch (err) {
        return { success: false, error: err.message, threadId: sId };
      }
    }

    if (isPinned) {
      this.pinnedThreads.add(sId);
    } else {
      this.pinnedThreads.delete(sId);
    }
    this.savePinnedThreads();

    return { success: true, isPinned: isPinned, threadId: sId };
  }

  // Lấy chi tiết thông tin và danh sách thành viên nhóm Zalo
  async getGroupDetails(groupId) {
    if (!this.api) throw new Error('Chưa kết nối với Zalo');
    const gid = String(groupId);
    let groupInfo = null;

    if (this.api.getGroupInfo) {
      try {
        const res = await this.api.getGroupInfo(gid);
        groupInfo = res?.gridInfoMap?.[gid] || res?.data?.[gid] || res?.[gid];
      } catch (e) {
        console.warn('Lỗi getGroupInfo:', e.message);
      }
    }

    let members = [];
    const memberIds = groupInfo?.memVerList || groupInfo?.members || [];
    if (Array.isArray(memberIds) && memberIds.length > 0 && this.api.getGroupMembersInfo) {
      try {
        const memRes = await this.api.getGroupMembersInfo(memberIds.slice(0, 50));
        const memMap = memRes?.data || memRes || {};
        members = Object.values(memMap).map(m => ({
          userId: m.userId || m.uid,
          name: m.dName || m.zaloName || m.name || 'Thành viên',
          avatar: m.avatar || '',
          isOwner: String(m.userId) === String(groupInfo?.creatorId),
          isDeputy: Array.isArray(groupInfo?.adminIds) && groupInfo.adminIds.includes(String(m.userId))
        }));
      } catch (e) {
        console.warn('Lỗi getGroupMembersInfo:', e.message);
      }
    }

    return {
      groupId: gid,
      name: groupInfo?.name || this.cachedGroups?.[gid]?.name || 'Nhóm Zalo',
      avatar: groupInfo?.avt || this.cachedGroups?.[gid]?.avt || '',
      desc: groupInfo?.desc || '',
      totalMember: groupInfo?.totalMember || members.length || 0,
      creatorId: groupInfo?.creatorId || '',
      members: members
    };
  }

  async getConversationTools(threadId, isGroup = false) {
    if (!this.api) throw new Error('Chưa kết nối với Zalo');
    if (!threadId) throw new Error('Chưa chọn hội thoại');
    const [boardResponse, reminderResponse, pinResponse, friendBoardResponse] = await Promise.allSettled([
      isGroup && typeof this.api.getListBoard === 'function'
        ? this.api.getListBoard({ page: 1, count: 50 }, String(threadId))
        : { items: [] },
      typeof this.api.getListReminder === 'function'
        ? this.api.getListReminder({ page: 1, count: 50 }, String(threadId), isGroup ? 1 : 0)
        : [],
      this.getServerPinnedTopics(String(threadId)),
      !isGroup && typeof this.api.getFriendBoardList === 'function'
        ? this.api.getFriendBoardList(String(threadId)) : { data: [] }
    ]);
    const boardResult = boardResponse.status === 'fulfilled' ? boardResponse.value : { items: [] };
    const reminderResult = reminderResponse.status === 'fulfilled' ? reminderResponse.value : [];
    const pinResult = pinResponse.status === 'fulfilled' ? pinResponse.value : [];
    const friendBoardResult = friendBoardResponse.status === 'fulfilled' ? friendBoardResponse.value : { data: [] };
    return {
      boards: Array.isArray(boardResult?.items) ? boardResult.items : [],
      reminders: Array.isArray(reminderResult) ? reminderResult : [],
      pinTopics: Array.isArray(pinResult) ? pinResult : [],
      friendBoards: friendBoardResult
    };
  }

  async getServerPinnedTopics(threadId) {
    const utils = require(path.join(__dirname, '../../node_modules/zalo-api-final/dist/cjs/utils.cjs'));
    const ctx = this.api.getContext();
    const host = this.api.zpwServiceMap?.group_board?.[0];
    if (!host) return [];
    const params = { groupId: String(threadId).replace(/^g_/, ''), boardVersion: 0, imei: ctx.imei };
    const encrypted = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
    if (!encrypted) return [];
    const url = utils.makeURL(ctx, `${host}/api/board/pin/list`, { params: encrypted });
    const response = await utils.request(ctx, url, { method: 'GET' });
    if (!response.ok) throw new Error(`Không tải được tin ghim (HTTP ${response.status})`);
    const json = await response.json();
    if (Number(json?.error_code || 0) !== 0) throw new Error(`Zalo trả về mã ${json.error_code} khi tải tin ghim`);
    const decoded = typeof json?.data === 'string' ? utils.decodeAES(ctx.secretKey, json.data) : json?.data;
    const outer = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    const data = typeof outer?.data === 'string' ? JSON.parse(outer.data) : (outer?.data || outer);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /**
   * Tạo bình chọn / thăm dò ý kiến trong nhóm (Poll)
   */
  async createGroupPoll(groupId, options) {
    if (!this.api) throw new Error('Chưa đăng nhập Zalo');
    if (this.api.createPoll) {
      return await this.api.createPoll({
        question: options.question,
        options: options.options,
        allowMultiChoices: !!options.allowMultiChoices,
        allowAddNewOption: !!options.allowAddNewOption,
        isAnonymous: !!options.isAnonymous
      }, groupId);
    }
    throw new Error('API createPoll không khả dụng trên phiên bản này');
  }

  /**
   * Tạo lịch hẹn / nhắc việc trong nhóm hoặc cá nhân (Reminder)
   */
  async createGroupReminder(threadId, options, isGroup = true) {
    if (!this.api) throw new Error('Chưa đăng nhập Zalo');
    if (this.api.createReminder) {
      const type = isGroup ? 1 : 0;
      return await this.api.createReminder({
        title: options.title,
        startTime: options.startTime || Date.now(),
        emoji: options.emoji || '⏰'
      }, threadId, type);
    }
    throw new Error('API createReminder không khả dụng trên phiên bản này');
  }
}

module.exports = ZaloManager;
