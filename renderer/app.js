document.addEventListener('DOMContentLoaded', async () => {
  const settingsPanel = document.getElementById('settings-panel');
  const mainContent = document.getElementById('main-content');
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings');
  const saveSettingsBtn = document.getElementById('save-settings');
  const scanBtn = document.getElementById('scan-btn');
  const resultsSection = document.getElementById('results');
  const hintText = document.getElementById('hint-text');
  const duplicateList = document.getElementById('duplicate-list');

  let currentGroups = [];

  async function loadSettings() {
    const s = await window.api.getSettings();
    document.getElementById('google-client-id').value = s.googleClientId || '';
    document.getElementById('google-client-secret').value = s.googleClientSecret || '';
    document.getElementById('dropbox-client-id').value = s.dropboxClientId || '';
    document.getElementById('dropbox-client-secret').value = s.dropboxClientSecret || '';
    document.getElementById('onedrive-client-id').value = s.onedriveClientId || '';
    document.getElementById('onedrive-client-secret').value = s.onedriveClientSecret || '';
  }

  async function refreshConnections() {
    const conn = await window.api.getConnections();
    updateService('dropbox', conn.dropbox);
    updateService('onedrive', conn.onedrive);
    updateService('google', conn.google);

    const any = conn.dropbox || conn.onedrive || conn.google;
    scanBtn.disabled = !any;
    hintText.textContent = any
      ? 'Ready to scan'
      : 'Connect at least one account (and make sure API keys are saved in Settings)';
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

  window.api.onAuthResult(async (data) => {
    if (data.success) {
      alert(`${data.service} connected successfully!`);
      await refreshConnections();
    } else {
      alert(`Failed to connect ${data.service}: ${data.error}`);
    }
  });

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderGroups(groups) {
    currentGroups = groups;
    if (!groups.length) {
      duplicateList.innerHTML = '<p style="color:#9ca3af">No duplicate groups found.</p>';
      return;
    }

    let html = '';
    groups.forEach((group, gIdx) => {
      const weakNote = group.weak ? ' <span style="color:#f59e0b;font-size:0.8rem">(size+name match – weaker)</span>' : '';
      html += `
        <div class="dupe-group" data-group="${gIdx}">
          <div class="dupe-header">
            <strong>${group.count} identical files</strong> · ${formatSize(group.size)} each${weakNote}
          </div>
          <div class="dupe-files">
      `;

      group.files.forEach((file, fIdx) => {
        html += `
          <label class="dupe-file">
            <input type="checkbox" data-group="${gIdx}" data-file="${fIdx}" class="file-check">
            <span class="service-badge ${file.service}">${file.service}</span>
            <span class="file-name" title="${file.path || file.name}">${file.name}</span>
            <span class="file-size">${formatSize(file.size)}</span>
          </label>
        `;
      });

      html += `
          </div>
          <button class="btn danger delete-group-btn" data-group="${gIdx}" style="margin-top:0.6rem;width:auto;padding:0.4rem 0.9rem;font-size:0.85rem">
            Delete selected in this group
          </button>
        </div>
      `;
    });

    duplicateList.innerHTML = html;

    // Attach delete handlers
    document.querySelectorAll('.delete-group-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const gIdx = parseInt(btn.dataset.group, 10);
        const group = currentGroups[gIdx];
        const checks = document.querySelectorAll(`.file-check[data-group="${gIdx}"]:checked`);

        if (checks.length === 0) {
          alert('Select at least one file to delete.');
          return;
        }

        // Safety: never allow deleting every file in a group
        if (checks.length >= group.files.length) {
          alert('You cannot delete every copy. Leave at least one file.');
          return;
        }

        const toDelete = [];
        checks.forEach(c => {
          const fIdx = parseInt(c.dataset.file, 10);
          toDelete.push(group.files[fIdx]);
        });

        const confirmMsg = `Delete ${toDelete.length} file(s)?\n\nThis cannot be undone.`;
        if (!confirm(confirmMsg)) return;

        btn.disabled = true;
        btn.textContent = 'Deleting...';

        const results = await window.api.deleteFiles(toDelete);
        const failed = results.filter(r => !r.success);

        if (failed.length) {
          alert(`Deleted some files, but ${failed.length} failed.`);
        } else {
          alert('Selected files deleted successfully.');
        }

        // Re-scan to refresh the list
        scanBtn.click();
      });
    });
  }

  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    resultsSection.hidden = false;
    duplicateList.innerHTML = '<p style="color:#9ca3af">Scanning your connected accounts for duplicates...</p>';

    const result = await window.api.startScan();

    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan for Duplicates';

    if (result.groups && result.groups.length > 0) {
      renderGroups(result.groups);
    } else {
      duplicateList.innerHTML = `<p style="color:#9ca3af">${result.message || 'No duplicates found.'}</p>`;
    }
  });

  await refreshConnections();
});
