document.addEventListener('DOMContentLoaded', async () => {
  const settingsPanel = document.getElementById('settings-panel');
  const mainContent = document.getElementById('main-content');
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings');
  const saveSettingsBtn = document.getElementById('save-settings');
  const scanBtn = document.getElementById('scan-btn');
  const resultsSection = document.getElementById('results');
  const hintText = document.getElementById('hint-text');

  // Load settings into form
  async function loadSettings() {
    const s = await window.api.getSettings();
    document.getElementById('google-client-id').value = s.googleClientId || '';
    document.getElementById('google-client-secret').value = s.googleClientSecret || '';
    document.getElementById('dropbox-client-id').value = s.dropboxClientId || '';
    document.getElementById('dropbox-client-secret').value = s.dropboxClientSecret || '';
    document.getElementById('onedrive-client-id').value = s.onedriveClientId || '';
    document.getElementById('onedrive-client-secret').value = s.onedriveClientSecret || '';
  }

  // Refresh connection status UI
  async function refreshConnections() {
    const conn = await window.api.getConnections();

    updateService('dropbox', conn.dropbox);
    updateService('onedrive', conn.onedrive);
    updateService('google', conn.google);

    const any = conn.dropbox || conn.onedrive || conn.google;
    scanBtn.disabled = !any;

    if (!any) {
      hintText.textContent = 'Connect at least one account (and make sure API keys are saved in Settings)';
    } else {
      hintText.textContent = 'Ready to scan';
    }
  }

  function updateService(name, isConnected) {
    const statusEl = document.getElementById(`${name}-status`);
    const connectBtn = document.getElementById(`connect-${name}`);
    const disconnectBtn = document.getElementById(`disconnect-${name}`);

    if (isConnected) {
      statusEl.textContent = 'Connected';
      statusEl.classList.add('connected');
      connectBtn.hidden = true;
      disconnectBtn.hidden = false;
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.classList.remove('connected');
      connectBtn.hidden = false;
      disconnectBtn.hidden = true;
    }
  }

  // Settings open/close
  settingsBtn.addEventListener('click', async () => {
    await loadSettings();
    settingsPanel.hidden = false;
    mainContent.hidden = true;
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.hidden = true;
    mainContent.hidden = false;
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const settings = {
      googleClientId: document.getElementById('google-client-id').value.trim(),
      googleClientSecret: document.getElementById('google-client-secret').value.trim(),
      dropboxClientId: document.getElementById('dropbox-client-id').value.trim(),
      dropboxClientSecret: document.getElementById('dropbox-client-secret').value.trim(),
      onedriveClientId: document.getElementById('onedrive-client-id').value.trim(),
      onedriveClientSecret: document.getElementById('onedrive-client-secret').value.trim()
    };

    await window.api.saveSettings(settings);
    alert('Keys saved successfully.');
    settingsPanel.hidden = true;
    mainContent.hidden = false;
  });

  // Connect buttons
  document.getElementById('connect-google').addEventListener('click', async () => {
    const result = await window.api.startGoogleAuth();
    if (result.error) alert(result.error);
  });

  document.getElementById('connect-dropbox').addEventListener('click', async () => {
    const result = await window.api.startDropboxAuth();
    if (result.error) alert(result.error);
  });

  document.getElementById('connect-onedrive').addEventListener('click', async () => {
    const result = await window.api.startOnedriveAuth();
    if (result.error) alert(result.error);
  });

  // Disconnect buttons
  document.getElementById('disconnect-google').addEventListener('click', async () => {
    await window.api.disconnect('google');
    await refreshConnections();
  });

  document.getElementById('disconnect-dropbox').addEventListener('click', async () => {
    await window.api.disconnect('dropbox');
    await refreshConnections();
  });

  document.getElementById('disconnect-onedrive').addEventListener('click', async () => {
    await window.api.disconnect('onedrive');
    await refreshConnections();
  });

  // Auth result from main process
  window.api.onAuthResult(async (data) => {
    if (data.success) {
      alert(`${data.service} connected successfully!`);
      await refreshConnections();
    } else {
      alert(`Failed to connect ${data.service}: ${data.error}`);
    }
  });

  // Scan
  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    resultsSection.hidden = false;
    document.getElementById('duplicate-list').innerHTML = '<p style="color:#9ca3af">Scanning your connected accounts for duplicates...</p>';

    const result = await window.api.startScan();

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan for Duplicates';

    if (result.groups && result.groups.length > 0) {
      // Will render groups when scanner is complete
      document.getElementById('duplicate-list').innerHTML = `<p>Found ${result.groups.length} groups of duplicates.</p>`;
    } else {
      document.getElementById('duplicate-list').innerHTML = `<p style="color:#9ca3af">${result.message || 'No duplicates found (or scanner still being finalized).'}</p>`;
    }
  });

  // Initial load
  await refreshConnections();
});
