document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scan-btn');
  const resultsSection = document.getElementById('results');

  // Update connection status on load
  async function refreshStatus() {
    const connections = await window.api.getConnections();

    updateCard('dropbox', connections.dropbox);
    updateCard('onedrive', connections.onedrive);
    updateCard('google', connections.googleDrive || connections.googlePhotos);

    const anyConnected = connections.dropbox || connections.onedrive || connections.googleDrive || connections.googlePhotos;
    scanBtn.disabled = !anyConnected;
  }

  function updateCard(service, isConnected) {
    const statusEl = document.getElementById(`${service}-status`);
    if (!statusEl) return;

    if (isConnected) {
      statusEl.textContent = 'Connected';
      statusEl.classList.add('connected');
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.classList.remove('connected');
    }
  }

  // Connect buttons (placeholder for now)
  document.querySelectorAll('.btn.connect').forEach(btn => {
    btn.addEventListener('click', () => {
      const service = btn.dataset.service;
      alert(`OAuth login for ${service} will open in your browser.\n\nThis is the next step to implement fully.`);
    });
  });

  // Scan button (placeholder)
  scanBtn.addEventListener('click', () => {
    resultsSection.hidden = false;
    document.getElementById('duplicate-list').innerHTML = `
      <p style="color:#9ca3af; padding:1rem 0;">
        Scanning is not fully wired yet. Once OAuth is complete, this will show groups of identical files.
      </p>
    `;
  });

  await refreshStatus();
});
