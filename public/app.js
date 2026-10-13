// @ts-check

/**
 * @typedef {Object} FileRow
 * @property {string} id
 * @property {string} provider
 * @property {string} name
 * @property {string} path
 * @property {number | null} size
 * @property {boolean} trashable
 */

/**
 * @typedef {Object} GroupRow
 * @property {string} id
 * @property {'content' | 'weak'} match
 * @property {string | null} hashAlgo
 * @property {string | null} hashPreview
 * @property {number} count
 * @property {number | null} size
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
 * @property {string} trashMethod
 * @property {string[]} readScopes
 * @property {string[]} trashScopes
 * @property {string[]} albumScopes
 * @property {string[]} grantedScopes
 * @property {string} scopeNote
 */

const HASH_LABELS = {
  'dropbox-content-hash': 'Dropbox content hash',
  md5: 'MD5',
  sha1: 'SHA-1',
  quickXor: 'OneDrive quickXor',
};

const ERROR_TEXT = {
  access_denied: 'Sign-in was cancelled.',
  invalid_state: 'The sign-in session did not match. Connect again.',
  expired: 'The sign-in attempt expired. Connect again.',
  token_exchange: 'The provider did not finish sign-in.',
  not_configured: 'This provider is not configured on the server.',
};

const scanButton = /** @type {HTMLButtonElement} */ (need('scan'));
const selectExtrasButton = /** @type {HTMLButtonElement} */ (need('select-extras'));
const summary = need('summary');
const results = need('results');
const providersEl = need('providers');
const banner = need('banner');
const modePill = need('mode-pill');
const accountNote = need('account-note');
const confirmDialog = /** @type {HTMLDialogElement} */ (need('confirm-dialog'));
const photosDialog = /** @type {HTMLDialogElement} */ (need('photos-dialog'));
const confirmAck = /** @type {HTMLInputElement} */ (need('confirm-ack'));
const confirmGo = /** @type {HTMLButtonElement} */ (need('confirm-go'));
const confirmGrant = /** @type {HTMLAnchorElement} */ (need('confirm-grant'));
const photosGrant = /** @type {HTMLAnchorElement} */ (need('photos-grant'));
const photosAlbum = /** @type {HTMLButtonElement} */ (need('photos-album'));

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

scanButton.addEventListener('click', () => { scan().catch(showFailure); });
selectExtrasButton.addEventListener('click', selectExtras);
need('confirm-cancel').addEventListener('click', () => confirmDialog.close());
need('photos-close').addEventListener('click', () => photosDialog.close());
confirmAck.addEventListener('change', () => { confirmGo.disabled = !confirmAck.checked; });
confirmGo.addEventListener('click', () => { trashSelected().catch(showFailure); });
photosAlbum.addEventListener('click', () => { addAlbum().catch(showFailure); });

load().catch(showFailure);

async function load() {
  const session = await api('/api/session');
  if (!session.ok) throw new Error('The app session could not be loaded.');
  csrf = String(session.data.csrf || '');
  mockMode = Boolean(session.data.mock);
  providers = /** @type {ProviderRow[]} */ (session.data.providers || []);
  manualSteps = /** @type {string[]} */ (session.data.photosManualSteps || []);
  modePill.textContent = mockMode ? 'Demo data' : 'Live accounts';
  accountNote.textContent = mockMode
    ? 'Demo mode is on. These are sample libraries, not your accounts. No sign-in and no cloud calls.'
    : 'Live mode keeps tokens on the server. The browser never sees them.';
  renderProviders();
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error') || '';
  const connected = params.get('connected') || '';
  if (errorCode || connected) {
    const provider = providers.find((item) => item.id === connected);
    const message = provider
      ? `${provider.name} is connected.`
      : (ERROR_TEXT[/** @type {keyof typeof ERROR_TEXT} */ (errorCode)] || 'Sign-in did not finish. Try again.');
    showBanner(message);
    window.history.replaceState({}, '', '/');
  }
  updateScanState();
}

function renderProviders() {
  providersEl.replaceChildren();
  for (const provider of providers) {
    const card = el('article', `card ${provider.id}`);
    const header = el('header');
    const title = el('h3', '', provider.name);
    const status = el('span', provider.connected ? 'status on' : 'status', provider.connected ? 'Connected' : 'Off');
    header.append(title, status);
    const blurb = el('p', 'blurb', provider.blurb);
    const details = document.createElement('details');
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = 'Permissions';
    details.append(summaryEl, el('p', 'scope', provider.scopeNote));
    const grant = el('p', 'grant', grantLabel(provider));
    const actions = el('div', 'actions');
    if (provider.connected) {
      const disconnect = button('Disconnect', 'ghost');
      disconnect.addEventListener('click', () => { disconnectProvider(provider.id).catch(showFailure); });
      actions.append(disconnect);
    } else {
      const connect = anchor(mockMode ? 'Connect sample' : 'Connect', `/auth/${provider.id}/start?purpose=connect`);
      actions.append(connect);
    }
    card.append(header, blurb, details, grant, actions);
    providersEl.append(card);
  }
}

/** @param {ProviderRow} provider */
function grantLabel(provider) {
  if (!provider.trashable) return 'Photos API cannot move items to trash.';
  if (!provider.connected) return 'Trash permission is requested only after you confirm a move.';
  const ready = provider.trashScopes.every((scope) => provider.grantedScopes.includes(scope));
  return ready ? 'Trash permission granted. Deletes still need confirmation.' : 'Connected for scanning. Trash permission is not granted yet.';
}

function updateScanState() {
  const connected = providers.some((provider) => provider.connected);
  scanButton.disabled = !connected;
  if (!connected) summary.textContent = 'Connect an account to scan.';
}

async function scan() {
  scanButton.disabled = true;
  summary.textContent = 'Scanning…';
  const response = await api('/api/scan', { method: 'POST', body: {} });
  scanButton.disabled = false;
  if (!response.ok) {
    summary.textContent = String(response.data.message || 'Scan failed.');
    return;
  }
  groups = /** @type {GroupRow[]} */ (response.data.groups || []);
  const wasted = groups.reduce((sum, group) => sum + (group.wastedBytes || 0), 0);
  summary.textContent = groups.length
    ? `${response.data.totalFiles} files · ${groups.length} duplicate groups · ${formatBytes(wasted)} could move to trash`
    : String(response.data.message || 'No duplicates in the connected accounts.');
  selectExtrasButton.hidden = groups.length === 0;
  renderGroups();
}

function renderGroups() {
  results.replaceChildren();
  if (groups.length === 0) {
    results.append(el('div', 'empty', 'No duplicate groups yet. Connect a sample account and scan.'));
    return;
  }
  groups.forEach((group) => {
    const card = el('article', `group ${group.match}`);
    const head = el('div', 'group-head');
    const copy = el('div');
    copy.append(el('h3', '', groupTitle(group)));
    const detail = group.match === 'content'
      ? `${hashLabel(group.hashAlgo)} ${group.hashPreview || ''}`
      : 'Same name and size only. Open the files before moving anything.';
    copy.append(el('p', 'meta', detail));
    const badge = el('span', group.match === 'content' ? 'badge good' : 'badge warn', group.match === 'content' ? 'Content hash' : 'Weaker match');
    head.append(copy, badge);
    card.append(head);
    for (const file of group.files) card.append(renderFile(file));
    const actions = el('div', 'group-actions');
    const trashable = group.files.some((file) => file.trashable);
    const photos = group.files.filter((file) => file.provider === 'gphotos');
    if (trashable) {
      const open = button('Move selected to trash', 'danger');
      open.addEventListener('click', () => openTrash(group));
      actions.append(open);
    }
    if (photos.length > 0) {
      const review = button('Review Photos copies', 'ghost');
      review.addEventListener('click', () => openPhotos(photos));
      actions.append(review);
    }
    card.append(actions);
    results.append(card);
  });
}

/** @param {FileRow} file */
function renderFile(file) {
  const row = el('label', 'file');
  if (file.trashable) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.fileId = file.id;
    row.append(box);
  } else {
    row.append(el('span', 'badge blocked', 'No trash API'));
  }
  const main = el('div', 'file-main');
  const line = el('p');
  line.append(el('span', 'provider-pill', providerName(file.provider)), document.createTextNode(` ${file.name}`));
  main.append(line, el('p', 'path', file.path));
  row.append(main, el('span', 'size', formatBytes(file.size)));
  return row;
}

/** @param {GroupRow} group */
function openTrash(group) {
  const selected = checkedFiles().filter((file) => group.files.some((item) => item.id === file.id));
  if (selected.length === 0) {
    showBanner('Select at least one extra copy in this group.');
    return;
  }
  if (selected.length >= group.files.length) {
    showBanner('Leave at least one copy in the group.');
    return;
  }
  fillTrashDialog(selected);
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
  need('confirm-copy').textContent = 'Dropbox sends these to deleted files, OneDrive to the recycle bin, and Google Drive marks them trashed. This app will not permanently delete them.';
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
  const ids = [...need('confirm-files').querySelectorAll('li')].map((item) => item.dataset.fileId || '').filter(Boolean);
  confirmGo.disabled = true;
  const response = await api('/api/trash', {
    method: 'POST',
    body: { ids, confirmation: 'MOVE_TO_TRASH' },
  });
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
  groups = /** @type {GroupRow[]} */ (response.data.groups || []);
  showBanner(response.data.ok ? 'Selected files were moved to trash.' : 'Some files could not be moved. The list has been refreshed.');
  summary.textContent = `${groups.length} duplicate groups remain.`;
  selectExtrasButton.hidden = groups.length === 0;
  renderGroups();
  await refreshProviders();
}

/** @param {FileRow[]} photos */
function openPhotos(photos) {
  pendingPhotoIds = photos.map((file) => file.id);
  photosGrant.hidden = true;
  const error = need('photos-error');
  error.hidden = true;
  error.textContent = '';
  need('photos-copy').textContent = `${photos.length} Google Photos ${photos.length === 1 ? 'item stays' : 'items stay'} in the library. An album only makes them easier to find.`;
  const steps = need('photos-steps');
  steps.replaceChildren();
  for (const step of manualSteps) {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  }
  const names = document.createElement('li');
  names.textContent = `Files: ${photos.map((file) => file.name).join(', ')}`;
  steps.append(names);
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
  if (!response.ok) {
    error.hidden = false;
    error.textContent = String(response.data.message || 'The album was not created.');
    if (response.data.error === 'insufficient_scope') {
      photosGrant.hidden = false;
      photosGrant.href = '/auth/gphotos/start?purpose=album';
    }
    return;
  }
  error.hidden = false;
  error.textContent = `${response.data.note || 'Album updated.'} Album: ${response.data.albumTitle || 'Duplicate review'}.`;
  await refreshProviders();
}

function selectExtras() {
  for (const group of groups) {
    let kept = false;
    for (const file of group.files) {
      const box = document.querySelector(`input[data-file-id="${CSS.escape(file.id)}"]`);
      if (!(box instanceof HTMLInputElement)) continue;
      box.checked = kept;
      if (!kept) kept = true;
    }
  }
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
  selectExtrasButton.hidden = true;
  summary.textContent = 'Disconnected. Scan again when you are ready.';
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

function checkedFiles() {
  /** @type {FileRow[]} */
  const selected = [];
  for (const group of groups) {
    for (const file of group.files) {
      const box = document.querySelector(`input[data-file-id="${CSS.escape(file.id)}"]`);
      if (box instanceof HTMLInputElement && box.checked) selected.push(file);
    }
  }
  return selected;
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
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  showBanner(message);
  scanButton.disabled = !providers.some((provider) => provider.connected);
}

/** @param {string} message */
function showBanner(message) {
  banner.hidden = false;
  banner.textContent = message;
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
  const size = group.size == null ? 'mixed sizes' : formatBytes(group.size);
  return `${group.count} copies · ${size}`;
}

/** @param {string | null} algo */
function hashLabel(algo) {
  if (!algo) return 'Content hash';
  return HASH_LABELS[/** @type {keyof typeof HASH_LABELS} */ (algo)] || algo;
}

/** @param {string} id */
function providerName(id) {
  return providers.find((provider) => provider.id === id)?.name || id;
}

/** @param {number | null} bytes */
function formatBytes(bytes) {
  if (bytes == null) return 'Size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
