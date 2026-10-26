const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accounts', {
  list: () => ipcRenderer.invoke('account-list'),
  create: (name, password) => ipcRenderer.invoke('account-create', name, password),
  unlock: (id, password) => ipcRenderer.invoke('account-unlock', id, password)
});
