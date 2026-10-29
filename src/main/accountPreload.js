const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accounts', {
  list: () => ipcRenderer.invoke('account-list'),
  create: (name, password) => ipcRenderer.invoke('account-create', name, password),
  unlock: (id, password) => ipcRenderer.invoke('account-unlock', id, password),
  setPassword: (id, password) => ipcRenderer.invoke('account-set-password', id, password),
  remove: (id, password) => ipcRenderer.invoke('account-remove', id, password),
  webLogin: (username, password, accountId) =>
    ipcRenderer.invoke('account-web-login', username, password, accountId),
  webRegister: (username, password) => ipcRenderer.invoke('account-web-register', username, password)
});
