const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getConnections: () => ipcRenderer.invoke('get-connections'),
  disconnect: (service) => ipcRenderer.invoke('disconnect', service),
  startGoogleAuth: () => ipcRenderer.invoke('start-google-auth'),
  startDropboxAuth: () => ipcRenderer.invoke('start-dropbox-auth'),
  startOnedriveAuth: () => ipcRenderer.invoke('start-onedrive-auth'),
  startScan: () => ipcRenderer.invoke('start-scan'),
  deleteFiles: (files) => ipcRenderer.invoke('delete-files', files),

  onAuthResult: (callback) => {
    ipcRenderer.on('auth-result', (event, data) => callback(data));
  }
});
