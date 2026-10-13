// @ts-check

/**
 * @typedef {Object} FileRow
 * @property {string} id
 * @property {string} provider
 * @property {string} name
 * @property {string} path
 * @property {number | null} size
 * @property {string | null} modifiedAt
 * @property {string} kind
 * @property {boolean} trashable
 * @property {boolean} hasPreview
 */

/**
 * @typedef {Object} GroupRow
 * @property {string} id
 * @property {'content' | 'weak'} match
 * @property {string | null} hashAlgo
 * @property {number} count
 * @property {number | null} wastedBytes
 * @property {FileRow[]} files
 */

/**
 * @typedef {Object} ProviderRow
 * @property {string} id
 * @property {string} name
 * @property {string} blurb
 * @property {boolean} connected
 * @property {boolean} trashable
 * @property {string[]} readScopes
 * @property {string[]} trashScopes
 * @property {string[]} albumScopes
 * @property {string[]} grantedScopes
 * @property {string} scopeNote
 */

const KIND_LABEL = { image: 'IMG', video: 'VIDEO', pdf: 'PDF', sheet: 'SHEET', text: 'TEXT', other: 'FILE' };
const ERROR_TEXT = {
  access_denied: 'Sign-in was cancelled.',
  invalid_state: 'The sign-in session did not match. Connect again.',
  expired: 'The sign-in attempt expired. Connect again.',
  token_exchange: 'The provider did not finish sign-in.',
  not_configured: 'This provider is not configured on the server.',
};

const scanButton = /** @type {HTMLButtonElement} */ (need('scan'));
const summaryDetail = need('savings-detail');
const savings = need('savings');
const savingsValue = need('savings-value');
const results = need('results');
const providersEl = need('providers');
const banner = need('banner');
const modePill = need('mode-pill');
const accountNote = need('account-note');
const progressWrap = need('progress-wrap');
const progressBar = /** @type {HTMLElement} */ (need('progress-bar'));
const progressLabel = need('progress-label');
const compareDialog = /** @type {HTMLDialogElement} */ (need('compare-dialog'));
const confirmDialog = /** @type {HTMLDialogElement} */ (need('confirm-dialog'));
const photosDialog = /** @type {HTMLDialogElement} */ (need('photos-dialog'));
const confirmAck = /** @type {HTMLInputElement} */ (need('confirm-ack'));
const confirmGo = /** @type {HTMLButtonElement} */ (need('confirm-go'));
const confirmGrant = /** @type {HTMLAnchorElement} */ (need('confirm-grant'));
const photosGrant = /** @type {HTMLAnchorElement} */ (need('photos-grant'));
const photosAlbum = /** @type {HTMLButtonElement} */ (need('photos-album'));
const compareTrash = /** @type {HTMLButtonElement} */ (need('compare-trash'));
const comparePhotos = /** @type {HTMLButtonElement} */ (need('compare-photos'));
const themeToggle = /** @type {HTMLButtonElement} */ (need('theme-toggle'));

/** @type {string} */
let csrf = '';
/** @type {boolean} */
let mockMode = true;
/** @type {ProviderRow[]} */
let providers = [];
/** @type {GroupRow[]} */
let groups = [];
/** @type {string[]} */
let manualSteps = [];
/** @type {string[]} */
let pendingPhotoIds = [];
/** @type {GroupRow | null} */
let compareGroup = null;
/** @type {string} */
let keeperId = '';

applyTheme(readTheme());
scanButton.addEventListener('click', () => { scan().catch(showFailure); });
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
});
need('compare-close').addEventListener('click', () => compareDialog.close());
need('confirm-cancel').addEventListener('click', () => confirmDialog.close());
need('photos-close').addEventListener('click', () => photosDialog.close());
confirmAck.addEventListener('change', () => { confirmGo.disabled = !confirmAck.checked; });
confirmGo.addEventListener('click', () => { trashSelected().catch(showFailure); });
photosAlbum.addEventListener('click', () => { addAlbum().catch(showFailure); });
compareTrash.addEventListener('click', () => openTrashFromCompare());
comparePhotos.addEventListener('click', () => {
  if (!compareGroup) return;
  openPhotos(compareGroup.files.filter((file) => file.provider === 'gphotos'));
});

load().catch(showFailure);

async function load() {
  const session = await api('/api/session');
  if (!session.ok) throw new Error('The app session could not be loaded.');
  csrf = String(session.data.csrf || '');
  mockMode = Boolean(session.data.mock);
  providers = /** @type {ProviderRow[]} */ (session.data.providers || []);
  manualSteps = /** @type {string[]} */ (session.data.photosManualSteps || []);
  modePill.textContent = mockMode ? 'Sample library' : 'Live accounts';
  accountNote.textContent = mockMode
    ? 'Sample mode uses bundled previews. No account sign-in and no cloud calls.'
    : 'Live mode keeps tokens on the server. Previews use the read token already granted for scanning.';
  renderProviders();
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error') || '';
  const connected = params.get('connected') || '';
  if (errorCode || connected) {
    const provider = providers.find((item) => item.id === connected);
    const mapped = ERROR_TEXT[/** @type {keyof typeof ERROR_TEXT} */ (errorCode)];
    showBanner(provider ? `${provider.name} is connected.` : (mapped || 'Sign-in did not finish. Try again.'));
    window.history.replaceState({}, '', '/');
  }
  updateScanState();
}

function renderProviders() {
  providersEl.replaceChildren();
  for (const provider of providers) {
    const card = el('article', `card ${provider.id}`);
    const header = el('header');
    header.append(el('h3', '', provider.name), el('span', provider.connected ? 'status on' : 'status', provider.connected ? 'Connected' : 'Off'));
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Permissions';
    details.append(summary, el('p', 'scope', provider.scopeNote));
    const actions = el('div', 'actions');
    if (provider.connected) {
      const disconnect = button('Disconnect', 'ghost');
      disconnect.addEventListener('click', () => { disconnectProvider(provider.id).catch(showFailure); });
      actions.append(disconnect);
    } else {
      actions.append(anchor(mockMode ? 'Connect sample' : 'Connect', `/auth/${provider.id}/start?purpose=connect`));
    }
    card.append(header, el('p', 'blurb', provider.blurb), details, el('p', 'grant', grantLabel(provider)), actions);
    providersEl.append(card);
  }
}

/** @param {ProviderRow} provider */
function grantLabel(provider) {
  if (!provider.trashable) return 'Photos API cannot move items to trash.';
  if (!provider.connected) return 'Trash permission is requested only after you confirm.';
  const ready = provider.trashScopes.every((scope) => provider.grantedScopes.includes(scope));
  return ready ? 'Trash permission granted. Deletes still need confirmation.' : 'Connected for scanning. Trash permission is not granted yet.';
}

function updateScanState() {
  scanButton.disabled = !providers.some((provider) => provider.connected);
}

async function scan() {
  const connected = providers.filter((provider) => provider.connected);
  scanButton.disabled = true;
  showProgress(0.05, 'Starting scan…');
  const reset = await api('/api/scan/reset', { method: 'POST', body: {} });
  if (!reset.ok) {
    hideProgress();
    scanButton.disabled = false;
    showBanner(String(reset.data.message || 'Scan could not start.'));
    return;
  }
  for (let index = 0; index < connected.length; index += 1) {
    const provider = connected[index];
    showProgress((index + 0.2) / connected.length, `Scanning ${provider.name}…`);
    const step = await api('/api/scan/step', { method: 'POST', body: { provider: provider.id } });
    if (!step.ok) {
      hideProgress();
      scanButton.disabled = false;
      showBanner(String(step.data.message || `Could not scan ${provider.name}.`));
      return;
    }
  }
  showProgress(0.92, 'Grouping duplicates…');
  const result = await api('/api/scan/finish', { method: 'POST', body: {} });
  hideProgress();
  scanButton.disabled = false;
  if (!result.ok) {
    showBanner(String(result.data.message || 'Scan failed.'));
    return;
  }
  groups = /** @type {GroupRow[]} */ (result.data.groups || []);
  const wasted = Number(result.data.summary?.wastedBytes || 0);
  savings.hidden = false;
  savingsValue.textContent = formatBytes(wasted);
  summaryDetail.textContent = groups.length
    ? `${result.data.totalFiles} files · ${groups.length} groups. Choose the copy to keep, then confirm before anything is trashed.`
    : String(result.data.message || 'No duplicates in the connected accounts.');
  renderGroups();
}

function renderGroups() {
  results.replaceChildren();
  if (!groups.length) {
    results.append(el('div', 'banner', 'No duplicate groups yet. Connect a sample account and scan.'));
    return;
  }
  for (const group of groups) {
    const card = button('', 'group-card');
    card.append(mosaic(group), el('h3', '', groupTitle(group)), el('p', 'meta', group.match === 'content' ? 'Content hash' : 'Same name and size only'));
    const badge = el('span', group.match === 'content' ? 'badge good' : 'badge warn', group.match === 'content' ? 'Content hash' : 'Weaker match');
    card.append(badge);
    card.addEventListener('click', () => openCompare(group));
    results.append(card);
  }
}

/** @param {GroupRow} group */
function mosaic(group) {
  const wrap = el('div', 'mosaic');
  for (const file of group.files.slice(0, 4)) wrap.append(previewNode(file));
  return wrap;
}

/** @param {FileRow} file */
function previewNode(file) {
  if (file.hasPreview) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.alt = file.name;
    img.src = `/api/preview?id=${encodeURIComponent(file.id)}`;
    img.addEventListener('error', () => {
      const icon = fileIcon(file.kind);
      img.replaceWith(icon);
    });
    return img;
  }
  return fileIcon(file.kind);
}

/** @param {string} kind */
function fileIcon(kind) {
  const label = KIND_LABEL[/** @type {keyof typeof KIND_LABEL} */ (kind)] || 'FILE';
  return el('div', 'file-icon', label);
}

/** @param {GroupRow} group */
function openCompare(group) {
  compareGroup = group;
  const keeper = group.files.find((file) => file.trashable) || group.files[0];
  keeperId = keeper ? keeper.id : '';
  need('compare-title').textContent = groupTitle(group);
  need('compare-note').textContent = group.match === 'content'
    ? 'These copies share a content hash. Keep one, then confirm before the others move to trash.'
    : 'This match is only name and size. Compare the dates and locations before you keep one.';
  renderCompare();
  if (!compareDialog.open) compareDialog.showModal();
}

function renderCompare() {
  const grid = need('compare-grid');
  grid.replaceChildren();
  if (!compareGroup) return;
  const photos = compareGroup.files.filter((file) => file.provider === 'gphotos');
  const extras = trashCandidates();
  comparePhotos.hidden = photos.length === 0;
  compareTrash.hidden = extras.length === 0;
  compareTrash.textContent = extras.length ? `Move ${extras.length} other ${extras.length === 1 ? 'copy' : 'copies'} to trash` : 'Nothing else can be trashed';
  for (const file of compareGroup.files) {
    const card = el('article', `compare-card${file.id === keeperId ? ' kept' : ''}`);
    card.append(previewNode(file));
    const meta = el('div', 'file-meta');
    meta.append(
      el('p', '', file.name),
      el('p', 'meta', providerName(file.provider)),
      el('p', 'meta', formatBytes(file.size)),
      el('p', 'meta', file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : 'Date unknown'),
      el('p', 'meta', file.path),
    );
    if (!file.trashable) meta.append(el('p', 'badge blocked', 'No trash API'));
    const label = el('label', 'keep');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'keeper';
    radio.checked = file.id === keeperId;
    radio.addEventListener('change', () => {
      keeperId = file.id;
      renderCompare();
    });
    label.append(radio, document.createTextNode(' Keep this one'));
    card.append(meta, label);
    grid.append(card);
  }
}

function trashCandidates() {
  if (!compareGroup) return /** @type {FileRow[]} */ ([]);
  return compareGroup.files.filter((file) => file.trashable && file.id !== keeperId);
}

function openTrashFromCompare() {
  const extras = trashCandidates();
  if (!extras.length || !compareGroup) {
    showBanner('Leave the copy you want to keep. Photos cannot be trashed here.');
    return;
  }
  if (extras.length >= compareGroup.files.length) {
    showBanner('Leave at least one copy in the group.');
    return;
  }
  fillTrashDialog(extras);
  if (!confirmDialog.open) confirmDialog.showModal();
  confirmAck.focus();
}

/** @param {FileRow[]} selected */
function fillTrashDialog(selected) {
  confirmAck.checked = false;
  confirmGo.disabled = true;
  confirmGrant.hidden = true;
  const error = need('confirm-error');
  error.hidden = true;
  error.textContent = '';
  need('confirm-title').textContent = selected.length === 1 ? 'Move 1 file to trash?' : `Move ${selected.length} files to trash?`;
  need('confirm-copy').textContent = 'The copy you chose to keep stays. The others go to the provider trash or recycle bin. Nothing is permanently deleted.';
  const list = need('confirm-files');
  list.replaceChildren();
  for (const file of selected) {
    const item = document.createElement('li');
    item.textContent = `${providerName(file.provider)} · ${file.name} · ${file.path}`;
    item.dataset.fileId = file.id;
    list.append(item);
  }
}

async function trashSelected() {
  const ids = [...need('confirm-files').querySelectorAll('li')].map((item) => /** @type {HTMLElement} */ (item).dataset.fileId || '').filter(Boolean);
  confirmGo.disabled = true;
  const response = await api('/api/trash', { method: 'POST', body: { ids, confirmation: 'MOVE_TO_TRASH' } });
  if (!response.ok) {
    const error = need('confirm-error');
    error.hidden = false;
    error.textContent = String(response.data.message || 'The files were not moved.');
    if (response.data.error === 'insufficient_scope' && typeof response.data.provider === 'string') {
      confirmGrant.hidden = false;
      confirmGrant.href = `/auth/${response.data.provider}/start?purpose=trash`;
      confirmGrant.textContent = `Grant ${providerName(response.data.provider)} trash access`;
    } else {
      confirmGo.disabled = !confirmAck.checked;
    }
    return;
  }
  confirmDialog.close();
  compareDialog.close();
  groups = /** @type {GroupRow[]} */ (response.data.groups || []);
  const wasted = groups.reduce((sum, group) => sum + (group.wastedBytes || 0), 0);
  savingsValue.textContent = formatBytes(wasted);
  summaryDetail.textContent = `${groups.length} duplicate groups remain.`;
  showBanner(response.data.ok ? 'Selected files were moved to trash. The copy you kept is still there.' : 'Some files could not be moved. The list has been refreshed.');
  renderGroups();
  await refreshProviders();
}

/** @param {FileRow[]} photos */
function openPhotos(photos) {
  pendingPhotoIds = photos.map((file) => file.id);
  photosGrant.hidden = true;
  const error = need('photos-error');
  error.hidden = true;
  need('photos-copy').textContent = `${photos.length} Google Photos ${photos.length === 1 ? 'item stays' : 'items stay'} in the library. An album only makes them easier to find.`;
  const steps = need('photos-steps');
  steps.replaceChildren();
  for (const step of manualSteps) {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  }
  if (!photosDialog.open) photosDialog.showModal();
}

async function addAlbum() {
  photosAlbum.disabled = true;
  const response = await api('/api/photos/album', {
    method: 'POST',
    body: { ids: pendingPhotoIds, confirmation: 'ADD_TO_REVIEW_ALBUM' },
  });
  photosAlbum.disabled = false;
  const error = need('photos-error');
  error.hidden = false;
  if (!response.ok) {
    error.textContent = String(response.data.message || 'The album was not created.');
    if (response.data.error === 'insufficient_scope') {
      photosGrant.hidden = false;
      photosGrant.href = '/auth/gphotos/start?purpose=album';
    }
    return;
  }
  error.textContent = `${response.data.note || 'Album updated.'} Album: ${response.data.albumTitle || 'Duplicate review'}.`;
  await refreshProviders();
}

/** @param {string} provider */
async function disconnectProvider(provider) {
  const response = await api('/api/disconnect', { method: 'POST', body: { provider } });
  if (!response.ok) {
    showBanner(String(response.data.message || 'Could not disconnect.'));
    return;
  }
  providers = /** @type {ProviderRow[]} */ (response.data.providers || []);
  groups = [];
  results.replaceChildren();
  savings.hidden = true;
  renderProviders();
  updateScanState();
}

async function refreshProviders() {
  const session = await api('/api/session');
  if (!session.ok) return;
  providers = /** @type {ProviderRow[]} */ (session.data.providers || []);
  renderProviders();
  updateScanState();
}

/** @param {number} amount @param {string} label */
function showProgress(amount, label) {
  progressWrap.hidden = false;
  progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, amount)) * 100)}%`;
  progressLabel.textContent = label;
}

function hideProgress() {
  progressWrap.hidden = true;
  progressBar.style.width = '0';
}

/** @param {string} path @param {{ method?: string, body?: Record<string, unknown> }} [options] */
async function api(path, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrf;
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data: /** @type {Record<string, any>} */ (data) };
}

/** @param {unknown} error */
function showFailure(error) {
  hideProgress();
  showBanner(error instanceof Error ? error.message : 'Something went wrong.');
  updateScanState();
}

/** @param {string} message */
function showBanner(message) {
  banner.hidden = false;
  banner.textContent = message;
}

/** @param {string} theme */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  themeToggle.textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
}

function readTheme() {
  const match = document.cookie.match(/(?:^|; )theme=(dark|light)/);
  if (match) return match[1] === 'light' ? 'light' : 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** @param {string} id */
function need(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** @param {string} text @param {string} className */
function button(text, className) {
  const node = /** @type {HTMLButtonElement} */ (el('button', className, text));
  node.type = 'button';
  return node;
}

/** @param {string} text @param {string} href */
function anchor(text, href) {
  const node = /** @type {HTMLAnchorElement} */ (el('a', 'button', text));
  node.href = href;
  return node;
}

/** @param {GroupRow} group */
function groupTitle(group) {
  const space = group.wastedBytes == null ? 'size varies' : `${formatBytes(group.wastedBytes)} extra`;
  return `${group.count} copies · ${space}`;
}

/** @param {string} id */
function providerName(id) {
  return providers.find((provider) => provider.id === id)?.name || id;
}

/** @param {number | null | undefined} bytes */
function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return 'Size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
