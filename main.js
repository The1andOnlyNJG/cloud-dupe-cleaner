const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const http = require('http');
const url = require('url');
const fetch = require('node-fetch');

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
  if (authServer) authServer.close();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Settings & Connections ----------

ipcMain.handle('get-settings', () => ({
  googleClientId: store.get('googleClientId', ''),
  googleClientSecret: store.get('googleClientSecret', ''),
  dropboxClientId: store.get('dropboxClientId', ''),
  dropboxClientSecret: store.get('dropboxClientSecret', ''),
  onedriveClientId: store.get('onedriveClientId', ''),
  onedriveClientSecret: store.get('onedriveClientSecret', '')
}));

ipcMain.handle('save-settings', (event, settings) => {
  store.set('googleClientId', settings.googleClientId || '');
  store.set('googleClientSecret', settings.googleClientSecret || '');
  store.set('dropboxClientId', settings.dropboxClientId || '');
  store.set('dropboxClientSecret', settings.dropboxClientSecret || '');
  store.set('onedriveClientId', settings.onedriveClientId || '');
  store.set('onedriveClientSecret', settings.onedriveClientSecret || '');
  return true;
});

ipcMain.handle('get-connections', () => ({
  dropbox: !!store.get('dropbox_token'),
  onedrive: !!store.get('onedrive_token'),
  google: !!store.get('google_token')
}));

ipcMain.handle('disconnect', (event, service) => {
  store.delete(`${service}_token`);
  store.delete(`${service}_refresh`);
  return true;
});

// ---------- OAuth helper ----------

function startAuthServer(expectedState, onCode) {
  return new Promise((resolve, reject) => {
    if (authServer) authServer.close();

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

        setTimeout(() => {
          if (authServer) {
            authServer.close();
            authServer = null;
          }
        }, 800);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    authServer.listen(17890, '127.0.0.1', () => resolve());
    authServer.on('error', reject);
  });
}

ipcMain.handle('start-google-auth', async () => {
  const clientId = store.get('googleClientId');
  const clientSecret = store.get('googleClientSecret');
  if (!clientId || !clientSecret) return { error: 'Please set your Google Client ID and Secret in Settings first.' };

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
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code'
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
  if (!clientId || !clientSecret) return { error: 'Please set your Dropbox App Key and Secret in Settings first.' };

  const state = Math.random().toString(36).substring(2);
  const redirectUri = 'http://127.0.0.1:17890/callback';
  const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&token_access_type=offline&state=${state}`;

  await startAuthServer(state, async (code, error) => {
    if (error || !code) {
      mainWindow.webContents.send('auth-result', { service: 'dropbox', success: false, error: error || 'No code received' });
      return;
    }
    try {
      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, grant_type: 'authorization_code',
          client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri
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
  if (!clientId) return { error: 'Please set your Microsoft (OneDrive) Client ID in Settings first.' };

  const state = Math.random().toString(36).substring(2);
  const redirectUri = 'http://127.0.0.1:17890/callback';
  const scope = encodeURIComponent('Files.Read offline_access');
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scope}&state=${state}`;

  await startAuthServer(state, async (code, error) => {
    if (error || !code) {
      mainWindow.webContents.send('auth-result', { service: 'onedrive', success: false, error: error || 'No code received' });
      return;
    }
    try {
      const clientSecret = store.get('onedriveClientSecret', '');
      const body = new URLSearchParams({
        code, client_id: clientId, redirect_uri: redirectUri,
        grant_type: 'authorization_code', scope: 'Files.Read offline_access'
      });
      if (clientSecret) body.append('client_secret', clientSecret);

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

// ---------- Real Scanner ----------

async function listDropboxFiles(token) {
  const files = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const body = cursor ? { cursor } : { path: '', recursive: true, include_media_info: false, include_deleted: false, include_has_explicit_shared_members: false };
    const endpoint = cursor ? 'https://api.dropboxapi.com/2/files/list_folder/continue' : 'https://api.dropboxapi.com/2/files/list_folder';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Dropbox list failed: ${res.status}`);
    const data = await res.json();

    for (const entry of data.entries || []) {
      if (entry['.tag'] === 'file' && entry.content_hash) {
        files.push({
          id: entry.id,
          name: entry.name,
          path: entry.path_display,
          size: entry.size,
          hash: entry.content_hash,
          service: 'dropbox',
          providerId: entry.id
        });
      }
    }

    hasMore = data.has_more;
    cursor = data.cursor;
  }
  return files;
}

async function listGoogleDriveFiles(token) {
  const files = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields: 'nextPageToken, files(id, name, md5Checksum, size, mimeType, parents)',
      q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'"
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error(`Google Drive list failed: ${res.status}`);
    const data = await res.json();

    for (const f of data.files || []) {
      if (f.md5Checksum) {
        files.push({
          id: f.id,
          name: f.name,
          path: f.name,
          size: parseInt(f.size || '0', 10),
          hash: f.md5Checksum,
          service: 'google',
          providerId: f.id
        });
      }
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return files;
}

async function listOneDriveFiles(token) {
  const files = [];
  let nextLink = 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200&$select=id,name,size,file,folder';

  while (nextLink) {
    const res = await fetch(nextLink, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`OneDrive list failed: ${res.status}`);
    const data = await res.json();

    for (const item of data.value || []) {
      if (item.file && !item.folder) {
        // OneDrive does not always expose a reliable content hash in basic list.
        // We use size + name as a weak key and mark it for later improvement.
        const weakHash = `onedrive-${item.size}-${item.name}`;
        files.push({
          id: item.id,
          name: item.name,
          path: item.name,
          size: item.size || 0,
          hash: weakHash,
          service: 'onedrive',
          providerId: item.id,
          weak: true
        });
      }
    }
    nextLink = data['@odata.nextLink'] || null;
  }
  return files;
}

ipcMain.handle('start-scan', async () => {
  try {
    const allFiles = [];
    const errors = [];

    const dropboxToken = store.get('dropbox_token');
    const googleToken = store.get('google_token');
    const onedriveToken = store.get('onedrive_token');

    if (dropboxToken) {
      try {
        const dbxFiles = await listDropboxFiles(dropboxToken);
        allFiles.push(...dbxFiles);
      } catch (e) {
        errors.push(`Dropbox: ${e.message}`);
      }
    }

    if (googleToken) {
      try {
        const gFiles = await listGoogleDriveFiles(googleToken);
        allFiles.push(...gFiles);
      } catch (e) {
        errors.push(`Google: ${e.message}`);
      }
    }

    if (onedriveToken) {
      try {
        const odFiles = await listOneDriveFiles(onedriveToken);
        allFiles.push(...odFiles);
      } catch (e) {
        errors.push(`OneDrive: ${e.message}`);
      }
    }

    // Group by hash
    const hashMap = new Map();
    for (const file of allFiles) {
      if (!file.hash) continue;
      if (!hashMap.has(file.hash)) hashMap.set(file.hash, []);
      hashMap.get(file.hash).push(file);
    }

    const groups = [];
    for (const [hash, files] of hashMap.entries()) {
      if (files.length > 1) {
        groups.push({
          hash,
          size: files[0].size,
          count: files.length,
          files,
          weak: files.some(f => f.weak)
        });
      }
    }

    // Sort largest groups first
    groups.sort((a, b) => b.size * b.count - a.size * a.count);

    return {
      groups,
      totalFiles: allFiles.length,
      message: groups.length === 0
        ? (errors.length ? `No duplicates found. Errors: ${errors.join('; ')}` : 'No duplicates found.')
        : null,
      errors
    };
  } catch (err) {
    return { groups: [], message: `Scan failed: ${err.message}`, errors: [err.message] };
  }
});

// ---------- Safe Delete ----------

ipcMain.handle('delete-files', async (event, filesToDelete) => {
  const results = [];

  for (const file of filesToDelete) {
    try {
      if (file.service === 'dropbox') {
        const token = store.get('dropbox_token');
        const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: file.path })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        results.push({ id: file.id, success: true });
      } else if (file.service === 'google') {
        const token = store.get('google_token');
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.providerId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
        results.push({ id: file.id, success: true });
      } else if (file.service === 'onedrive') {
        const token = store.get('onedrive_token');
        const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${file.providerId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
        results.push({ id: file.id, success: true });
      }
    } catch (err) {
      results.push({ id: file.id, success: false, error: err.message });
    }
  }

  return results;
});
