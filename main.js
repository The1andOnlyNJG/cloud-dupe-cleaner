const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const http = require('http');
const url = require('url');

const store = new Store();

let mainWindow;
let authServer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 800,
    minWidth: 950,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Cloud Dupe Cleaner',
    show: false
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (authServer) {
    authServer.close();
  }
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC Handlers ----------

ipcMain.handle('get-settings', () => {
  return {
    googleClientId: store.get('googleClientId', ''),
    googleClientSecret: store.get('googleClientSecret', ''),
    dropboxClientId: store.get('dropboxClientId', ''),
    dropboxClientSecret: store.get('dropboxClientSecret', ''),
    onedriveClientId: store.get('onedriveClientId', ''),
    onedriveClientSecret: store.get('onedriveClientSecret', '')
  };
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set('googleClientId', settings.googleClientId || '');
  store.set('googleClientSecret', settings.googleClientSecret || '');
  store.set('dropboxClientId', settings.dropboxClientId || '');
  store.set('dropboxClientSecret', settings.dropboxClientSecret || '');
  store.set('onedriveClientId', settings.onedriveClientId || '');
  store.set('onedriveClientSecret', settings.onedriveClientSecret || '');
  return true;
});

ipcMain.handle('get-connections', () => {
  return {
    dropbox: !!store.get('dropbox_token'),
    onedrive: !!store.get('onedrive_token'),
    google: !!store.get('google_token')
  };
});

ipcMain.handle('disconnect', (event, service) => {
  store.delete(`${service}_token`);
  store.delete(`${service}_refresh`);
  return true;
});

// Start a temporary local server to catch OAuth redirects
function startAuthServer(expectedState, onCode) {
  return new Promise((resolve, reject) => {
    if (authServer) {
      authServer.close();
    }

    authServer = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);

      if (parsed.pathname === '/callback') {
        const code = parsed.query.code;
        const state = parsed.query.state;
        const error = parsed.query.error;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (error) {
          res.end(`<h2>Login failed</h2><p>${error}</p><p>You can close this window.</p>`);
          onCode(null, error);
        } else if (code && state === expectedState) {
          res.end(`<h2>Login successful!</h2><p>You can close this window and return to the app.</p>`);
          onCode(code, null);
        } else {
          res.end(`<h2>Invalid response</h2><p>You can close this window.</p>`);
          onCode(null, 'Invalid state or missing code');
        }

        // Close server after a short delay
        setTimeout(() => {
          if (authServer) {
            authServer.close();
            authServer = null;
          }
        }, 1000);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    authServer.listen(17890, '127.0.0.1', () => {
      resolve();
    });

    authServer.on('error', (err) => {
      reject(err);
    });
  });
}

ipcMain.handle('start-google-auth', async () => {
  const clientId = store.get('googleClientId');
  const clientSecret = store.get('googleClientSecret');

  if (!clientId || !clientSecret) {
    return { error: 'Please set your Google Client ID and Secret in Settings first.' };
  }

  const state = Math.random().toString(36).substring(2);
  const redirectUri = 'http://127.0.0.1:17890/callback';
  const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/photoslibrary.readonly');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;

  await startAuthServer(state, async (code, error) => {
    if (error || !code) {
      mainWindow.webContents.send('auth-result', { service: 'google', success: false, error: error || 'No code received' });
      return;
    }

    try {
      // Exchange code for tokens
      const fetch = require('node-fetch');
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenRes.json();

      if (tokens.access_token) {
        store.set('google_token', tokens.access_token);
        if (tokens.refresh_token) store.set('google_refresh', tokens.refresh_token);
        mainWindow.webContents.send('auth-result', { service: 'google', success: true });
      } else {
        mainWindow.webContents.send('auth-result', { service: 'google', success: false, error: tokens.error_description || 'Token exchange failed' });
      }
    } catch (err) {
      mainWindow.webContents.send('auth-result', { service: 'google', success: false, error: err.message });
    }
  });

  shell.openExternal(authUrl);
  return { success: true };
});

ipcMain.handle('start-dropbox-auth', async () => {
  const clientId = store.get('dropboxClientId');
  const clientSecret = store.get('dropboxClientSecret');

  if (!clientId || !clientSecret) {
    return { error: 'Please set your Dropbox App Key and Secret in Settings first.' };
  }

  const state = Math.random().toString(36).substring(2);
  const redirectUri = 'http://127.0.0.1:17890/callback';

  const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&token_access_type=offline&state=${state}`;

  await startAuthServer(state, async (code, error) => {
    if (error || !code) {
      mainWindow.webContents.send('auth-result', { service: 'dropbox', success: false, error: error || 'No code received' });
      return;
    }

    try {
      const fetch = require('node-fetch');
      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri
        })
      });

      const tokens = await tokenRes.json();

      if (tokens.access_token) {
        store.set('dropbox_token', tokens.access_token);
        if (tokens.refresh_token) store.set('dropbox_refresh', tokens.refresh_token);
        mainWindow.webContents.send('auth-result', { service: 'dropbox', success: true });
      } else {
        mainWindow.webContents.send('auth-result', { service: 'dropbox', success: false, error: tokens.error_description || 'Token exchange failed' });
      }
    } catch (err) {
      mainWindow.webContents.send('auth-result', { service: 'dropbox', success: false, error: err.message });
    }
  });

  shell.openExternal(authUrl);
  return { success: true };
});

ipcMain.handle('start-onedrive-auth', async () => {
  const clientId = store.get('onedriveClientId');

  if (!clientId) {
    return { error: 'Please set your Microsoft (OneDrive) Client ID in Settings first.' };
  }

  const state = Math.random().toString(36).substring(2);
  const redirectUri = 'http://127.0.0.1:17890/callback';
  const scope = encodeURIComponent('Files.Read offline_access');

  // Note: For personal Microsoft accounts, the authorize endpoint is different
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scope}&state=${state}`;

  await startAuthServer(state, async (code, error) => {
    if (error || !code) {
      mainWindow.webContents.send('auth-result', { service: 'onedrive', success: false, error: error || 'No code received' });
      return;
    }

    try {
      const clientSecret = store.get('onedriveClientSecret', '');
      const fetch = require('node-fetch');

      const body = new URLSearchParams({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'Files.Read offline_access'
      });

      if (clientSecret) {
        body.append('client_secret', clientSecret);
      }

      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });

      const tokens = await tokenRes.json();

      if (tokens.access_token) {
        store.set('onedrive_token', tokens.access_token);
        if (tokens.refresh_token) store.set('onedrive_refresh', tokens.refresh_token);
        mainWindow.webContents.send('auth-result', { service: 'onedrive', success: true });
      } else {
        mainWindow.webContents.send('auth-result', { service: 'onedrive', success: false, error: tokens.error_description || 'Token exchange failed' });
      }
    } catch (err) {
      mainWindow.webContents.send('auth-result', { service: 'onedrive', success: false, error: err.message });
    }
  });

  shell.openExternal(authUrl);
  return { success: true };
});

// Placeholder for scan - will be expanded
ipcMain.handle('start-scan', async () => {
  // For now return empty. Full scanning will be added next.
  return { groups: [], message: 'Scanning engine is being finalized. OAuth is ready.' };
});
