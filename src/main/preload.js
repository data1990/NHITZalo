const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Trạng thái Zalo & Đăng nhập
  startLoginQR: () => ipcRenderer.invoke('zalo-login-qr'),
  logoutZalo: () => ipcRenderer.invoke('zalo-logout'),
  checkSavedSession: () => ipcRenderer.invoke('zalo-check-session'),
  tryAutoLogin: () => ipcRenderer.invoke('zalo-auto-login'),
  getCurrentAccount: () => ipcRenderer.invoke('account-current'),
  switchAccount: () => ipcRenderer.invoke('account-switch'),
  changeAccountPassword: (current, next) => ipcRenderer.invoke('account-change-password', current, next),
  onAccountNameUpdated: (callback) => {
    const subscription = (event, name) => callback(name);
    ipcRenderer.on('account-name-updated', subscription);
    return () => ipcRenderer.removeListener('account-name-updated', subscription);
  },
  syncOldMessages: () => ipcRenderer.invoke('zalo-sync-old-messages'),
  quickSyncMessages: () => ipcRenderer.invoke('zalo-quick-sync-messages'),
  getSyncStatus: () => ipcRenderer.invoke('zalo-get-sync-status'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  getHistoryMessages: () => ipcRenderer.invoke('zalo-get-history-messages'),
  getConversationHeads: () => ipcRenderer.invoke('zalo-get-conversation-heads'),
  getMyCloudId: () => ipcRenderer.invoke('zalo-get-my-cloud-id'),
  fetchCloudMessages: (cursor = '0', older = false) => ipcRenderer.invoke('zalo-fetch-cloud-messages', { cursor, older }),
  getBubbleStartupMessages: () => ipcRenderer.invoke('zalo-get-bubble-startup'),
  getThreadHistory: (threadId, limit = 50, offset = 0) => ipcRenderer.invoke('zalo-get-thread-history', { threadId, limit, offset }),
  getLinkPreview: (url) => ipcRenderer.invoke('zalo-get-link-preview', url),
  openExternalLink: (url) => ipcRenderer.invoke('zalo-open-external-link', url),
  resolveGroupSenderNames: (threadId, senderIds) => ipcRenderer.invoke('zalo-resolve-group-senders', { threadId, senderIds }),
  searchHistoryMessages: (query, limit = 50, offset = 0) => ipcRenderer.invoke('zalo-search-history', { query, limit, offset }),
  clearHistoryMessages: () => ipcRenderer.invoke('zalo-clear-history-messages'),
  getGroupsList: () => ipcRenderer.invoke('zalo-get-groups'),
  fetchGroupsList: () => ipcRenderer.invoke('zalo-fetch-groups'),
  getFriendsList: () => ipcRenderer.invoke('zalo-get-friends'),
  fetchFriendsList: () => ipcRenderer.invoke('zalo-fetch-friends'),
  fetchThreadMessages: (threadId, isGroup) => ipcRenderer.invoke('zalo-fetch-thread-messages', { threadId, isGroup }),
  sendReply: (threadId, content, isGroup, quote, attachments) => ipcRenderer.invoke('zalo-send-reply', { threadId, content, isGroup, quote, attachments }),
  forwardTextMessage: (message, threadId, isGroup) => ipcRenderer.invoke('zalo-forward-text', { message, threadId, isGroup }),
  sendReaction: (threadId, msgId, cliMsgId, icon, isGroup) => ipcRenderer.invoke('zalo-send-reaction', { threadId, msgId, cliMsgId, icon, isGroup }),
  undoMessage: (threadId, msgId, cliMsgId, isGroup) => ipcRenderer.invoke('zalo-undo-message', { threadId, msgId, cliMsgId, isGroup }),
  setPinnedConversation: (threadId, isPinned, isGroup) => ipcRenderer.invoke('zalo-set-pinned', { threadId, isPinned, isGroup }),
  getPinnedThreads: () => ipcRenderer.invoke('zalo-get-pinned'),
  getMutedThreads: () => ipcRenderer.invoke('zalo-get-muted-threads'),
  fetchMutedThreads: () => ipcRenderer.invoke('zalo-fetch-muted-threads'),
  isThreadMuted: (threadId) => ipcRenderer.invoke('zalo-is-thread-muted', threadId),
  setThreadMute: (threadId, isMuted, isGroup, duration) => ipcRenderer.invoke('zalo-set-thread-mute', { threadId, isMuted, isGroup, duration }),
  getGroupDetails: (groupId) => ipcRenderer.invoke('zalo-get-group-details', groupId),
  getConversationTools: (threadId, isGroup) => ipcRenderer.invoke('zalo-get-conversation-tools', { threadId, isGroup }),
  createGroupPoll: (groupId, options) => ipcRenderer.invoke('zalo-create-poll', { groupId, options }),
  createGroupReminder: (threadId, options, isGroup) => ipcRenderer.invoke('zalo-create-reminder', { threadId, options, isGroup }),
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  sendSticker: (threadId, sticker, isGroup) => ipcRenderer.invoke('zalo-send-sticker', { threadId, sticker, isGroup }),
  getStickers: (keyword) => ipcRenderer.invoke('zalo-get-stickers', keyword),
  getStickersDetail: (stickerIds) => ipcRenderer.invoke('zalo-get-stickers-detail', stickerIds),
  markThreadRead: (threadId) => ipcRenderer.invoke('zalo-mark-thread-read', threadId),
  getReadThreads: () => ipcRenderer.invoke('zalo-get-read-threads'),

  // Lắng nghe sự kiện Zalo
  onZaloStatus: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('zalo-status-change', subscription);
    return () => ipcRenderer.removeListener('zalo-status-change', subscription);
  },
  onNewMessage: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('zalo-new-message', subscription);
    return () => ipcRenderer.removeListener('zalo-new-message', subscription);
  },
  onSyncStatus: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('zalo-sync-status', subscription);
    return () => ipcRenderer.removeListener('zalo-sync-status', subscription);
  },
  onMessageUndo: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('zalo-message-undo', subscription);
    return () => ipcRenderer.removeListener('zalo-message-undo', subscription);
  },
  onThreadMarkedAsRead: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('thread-marked-as-read', subscription);
    return () => ipcRenderer.removeListener('thread-marked-as-read', subscription);
  },
  onMessageReaction: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('zalo-message-reaction', subscription);
    return () => ipcRenderer.removeListener('zalo-message-reaction', subscription);
  },
  onPhotoCaptionUpdated: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('zalo-photo-caption-updated', subscription);
    return () => ipcRenderer.removeListener('zalo-photo-caption-updated', subscription);
  },

  // Bong bóng Chat Bubble
  bubbleExpand: () => ipcRenderer.send('bubble-expand'),
  bubbleCollapse: () => ipcRenderer.send('bubble-collapse'),
  bubbleDragMove: (deltaX, deltaY) => ipcRenderer.send('bubble-drag-move', { deltaX, deltaY }),
  bubbleDragEnd: () => ipcRenderer.send('bubble-drag-end'),
  bubbleResetPosition: () => ipcRenderer.send('bubble-reset-position'),
  bubbleToggleVisibility: (visible) => ipcRenderer.send('bubble-toggle-visibility', visible),
  bubbleHidePreview: () => ipcRenderer.send('bubble-hide-preview'),

  // Lắng nghe sự kiện trên Bong bóng
  onBubbleMessage: (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on('new-bubble-message', subscription);
    return () => ipcRenderer.removeListener('new-bubble-message', subscription);
  },
  onBubbleStateChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('bubble-state-changed', subscription);
    return () => ipcRenderer.removeListener('bubble-state-changed', subscription);
  },
  onBubbleShowPreview: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('bubble-show-preview', subscription);
    return () => ipcRenderer.removeListener('bubble-show-preview', subscription);
  },
  onBubblePreviewHidden: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('bubble-preview-hidden', subscription);
    return () => ipcRenderer.removeListener('bubble-preview-hidden', subscription);
  },
  onClearUnread: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('clear-unread-count', subscription);
    return () => ipcRenderer.removeListener('clear-unread-count', subscription);
  },
  onThreadMuteChanged: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('bubble-thread-mute-changed', subscription);
    return () => ipcRenderer.removeListener('bubble-thread-mute-changed', subscription);
  },

  // Tải và thao tác tệp tin máy tính
  downloadFile: (fileUrl, fileName, promptSaveAs = false) => ipcRenderer.invoke('zalo-download-file', { fileUrl, fileName, promptSaveAs }),
  openFilePath: (filePath) => ipcRenderer.invoke('open-file-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  saveClipboardImage: (base64Data) => ipcRenderer.invoke('save-clipboard-image', base64Data),

  // Test tin nhắn mẫu
  sendTestMessage: (customContent) => ipcRenderer.send('send-test-message', customContent),

  // Cửa sổ
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeDashboard: () => ipcRenderer.send('close-dashboard')
});
