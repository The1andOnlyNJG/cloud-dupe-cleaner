const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConnections: () => ipcRenderer.invoke('get-connections'),
  clearConnection: (service) => ipcRenderer.invoke('clear-connection', service)
});
