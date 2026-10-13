// @ts-check
import { AppError } from './errors.js';
import { REVIEW_ALBUM_TITLE } from './catalog.js';
import { splitCompositeId } from './mock-cloud.js';
import { asIso, kindFromName } from './media.js';

const PAGE_LIMIT = 50;

/**
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readJson(response) {
  return response.json();
}

/**
 * @param {string} localId
 */
export function assertItemId(localId) {
  if (typeof localId !== 'string' || localId.length < 1 || localId.length > 512) {
    throw new AppError('unknown_file', 'File id was not recognized.', 400);
  }
  if (/[\s/\\?#%]/.test(localId) || localId.includes('..')) {
    throw new AppError('unknown_file', 'File id was not recognized.', 400);
  }
}

/**
 * @param {string} filePath
 */
export function assertDropboxPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/') || filePath.length > 2048) {
    throw new AppError('unknown_file', 'Dropbox path was not recognized.', 400);
  }
  if (filePath.includes('\\') || filePath.includes('\0') || filePath.split('/').includes('..')) {
    throw new AppError('unknown_file', 'Dropbox path was not recognized.', 400);
  }
}

/**
 * @param {{ url: string, method: string }} request
 */
export function assertSafeTrashRequest(request) {
  const url = request.url.toLowerCase();
  if (url.includes('permanently_delete') || url.includes('permanentdelete') || url.includes('batchdelete')) {
    throw new AppError('hard_delete_forbidden', 'Permanent delete is not allowed.', 400);
  }
  if (url.includes('photoslibrary.googleapis.com') && request.method === 'DELETE') {
    throw new AppError('photos_cannot_trash', 'Google Photos items cannot be trashed by the API.', 409);
  }
  if (url.startsWith('https://www.googleapis.com/drive/') && request.method === 'DELETE') {
    throw new AppError('hard_delete_forbidden', 'Drive files.delete permanently deletes files and is refused.', 400);
  }
}

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} state
 * @param {string} codeChallenge
 * @param {string[]} scopes
 * @param {import('./types.js').OAuthPurpose} purpose
 */
export function buildAuthorizeUrl(provider, clientId, redirectUri, state, codeChallenge, scopes, purpose) {
  const scope = scopes.join(' ');
  /** @type {URL} */
  let url;
  if (provider === 'dropbox') {
    url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('scope', scope);
  } else if (provider === 'onedrive') {
    url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', scope);
    if (purpose !== 'connect') url.searchParams.set('prompt', 'consent');
  } else if (provider === 'gdrive' || provider === 'gphotos') {
    url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('scope', scope);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
  } else {
    throw new AppError('unknown_provider', 'Unknown provider.', 404);
  }
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (url.searchParams.has('client_secret') || url.searchParams.get('response_type') !== 'code') {
    throw new AppError('oauth_config', 'OAuth request was rejected.', 500);
  }
  return url.toString();
}

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string} code
 * @param {string} codeVerifier
 * @param {string} redirectUri
 * @param {string} clientId
 * @param {string} clientSecret
 */
export function buildTokenRequest(provider, code, codeVerifier, redirectUri, clientId, clientSecret) {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);
  body.set('client_id', clientId);
  body.set('code_verifier', codeVerifier);
  if (clientSecret) body.set('client_secret', clientSecret);
  const url = tokenEndpoint(provider);
  return {
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string} refreshToken
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string[]} scopes
 */
export function buildRefreshRequest(provider, refreshToken, clientId, clientSecret, scopes) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('client_id', clientId);
  if (clientSecret) body.set('client_secret', clientSecret);
  if (provider === 'onedrive') body.set('scope', scopes.join(' '));
  return {
    url: tokenEndpoint(provider),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

/**
 * @param {import('./types.js').ProviderId} provider
 */
function tokenEndpoint(provider) {
  if (provider === 'dropbox') return 'https://api.dropboxapi.com/oauth2/token';
  if (provider === 'onedrive') return 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  return 'https://oauth2.googleapis.com/token';
}

/**
 * @param {import('./types.js').CloudFile} file
 */
export function buildTrashRequest(file) {
  if (file.provider === 'gphotos' || !file.trashable) {
    throw new AppError(
      'photos_cannot_trash',
      'Google Photos items cannot be moved to trash by the API. Use a review album or trash them in Google Photos.',
      409,
    );
  }
  if (file.provider === 'dropbox') {
    assertDropboxPath(file.path);
    const request = {
      url: 'https://api.dropboxapi.com/2/files/delete_v2',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file.path }),
    };
    assertSafeTrashRequest(request);
    return request;
  }
  if (file.provider === 'gdrive') {
    const { localId } = splitCompositeId(file.id);
    assertItemId(localId);
    const request = {
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(localId)}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    };
    assertSafeTrashRequest(request);
    return request;
  }
  if (file.provider === 'onedrive') {
    const { localId } = splitCompositeId(file.id);
    assertItemId(localId);
    const request = {
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(localId)}`,
      method: 'DELETE',
      headers: {},
      body: undefined,
    };
    assertSafeTrashRequest(request);
    return request;
  }
  throw new AppError('unknown_provider', 'Unknown provider.', 404);
}

/**
 * @param {unknown} entries
 * @returns {import('./types.js').CloudFile[]}
 */
export function parseDropboxEntries(entries) {
  if (!Array.isArray(entries)) return [];
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  for (const entry of entries) {
    if (!entry || entry['.tag'] !== 'file' || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      continue;
    }
    const hash = typeof entry.content_hash === 'string' && entry.content_hash.trim()
      ? entry.content_hash.trim()
      : null;
    const path = typeof entry.path_display === 'string' ? entry.path_display : entry.name;
    files.push({
      id: `dropbox:${entry.id}`,
      provider: 'dropbox',
      name: entry.name,
      path,
      size: typeof entry.size === 'number' ? entry.size : null,
      hash,
      hashAlgo: hash ? 'dropbox-content-hash' : null,
      trashable: true,
      modifiedAt: asIso(entry.client_modified) || asIso(entry.server_modified),
      kind: kindFromName(entry.name),
      sampleKey: null,
      thumbnailUrl: kindFromName(entry.name) === 'image' ? path : null,
    });
  }
  return files;
}

/**
 * @param {unknown} files
 * @returns {import('./types.js').CloudFile[]}
 */
export function parseDriveFiles(files) {
  if (!Array.isArray(files)) return [];
  /** @type {import('./types.js').CloudFile[]} */
  const parsed = [];
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || typeof file.name !== 'string') continue;
    if (file.mimeType === 'application/vnd.google-apps.folder' || file.trashed === true) continue;
    const md5 = typeof file.md5Checksum === 'string' && file.md5Checksum.trim() ? file.md5Checksum.trim() : '';
    const sha1 = typeof file.sha1Checksum === 'string' && file.sha1Checksum.trim() ? file.sha1Checksum.trim() : '';
    const hash = md5 || sha1 || null;
    const hashAlgo = md5 ? 'md5' : sha1 ? 'sha1' : null;
    const parsedSize = typeof file.size === 'string' ? Number(file.size) : file.size;
    const size = typeof parsedSize === 'number' && Number.isFinite(parsedSize) ? parsedSize : null;
    const thumb = typeof file.thumbnailLink === 'string' && file.thumbnailLink.startsWith('https://')
      ? file.thumbnailLink
      : null;
    parsed.push({
      id: `gdrive:${file.id}`,
      provider: 'gdrive',
      name: file.name,
      path: file.name,
      size,
      hash,
      hashAlgo,
      trashable: true,
      modifiedAt: asIso(file.modifiedTime),
      kind: kindFromName(file.name),
      sampleKey: null,
      thumbnailUrl: thumb,
    });
  }
  return parsed;
}

/**
 * @param {unknown} items
 * @returns {import('./types.js').CloudFile[]}
 */
export function parseOneDriveItems(items) {
  if (!Array.isArray(items)) return [];
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  for (const item of items) {
    if (!item || item.folder || item.deleted || !item.file) continue;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const hashes = item.file.hashes || {};
    const sha1 = typeof hashes.sha1Hash === 'string' && hashes.sha1Hash.trim() ? hashes.sha1Hash.trim() : '';
    const quickXor = typeof hashes.quickXorHash === 'string' && hashes.quickXorHash.trim()
      ? hashes.quickXorHash.trim()
      : '';
    const hash = sha1 || quickXor || null;
    const hashAlgo = sha1 ? 'sha1' : quickXor ? 'quickXor' : null;
    const parent = item.parentReference && typeof item.parentReference.path === 'string'
      ? item.parentReference.path.replace(/^\/drive\/root:?/, '')
      : '';
    const path = parent ? `${parent}/${item.name}` : item.name;
    files.push({
      id: `onedrive:${item.id}`,
      provider: 'onedrive',
      name: item.name,
      path,
      size: typeof item.size === 'number' ? item.size : null,
      hash,
      hashAlgo,
      trashable: true,
      modifiedAt: asIso(item.lastModifiedDateTime),
      kind: kindFromName(item.name),
      sampleKey: null,
      thumbnailUrl: kindFromName(item.name) === 'image' ? item.id : null,
    });
  }
  return files;
}

/**
 * @param {unknown} items
 * @returns {import('./types.js').CloudFile[]}
 */
export function parsePhotoItems(items) {
  if (!Array.isArray(items)) return [];
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue;
    const name = typeof item.filename === 'string' && item.filename.trim() ? item.filename : 'Untitled';
    const baseUrl = typeof item.baseUrl === 'string' && item.baseUrl.startsWith('https://') ? item.baseUrl : null;
    const created = item.mediaMetadata && asIso(item.mediaMetadata.creationTime);
    files.push({
      id: `gphotos:${item.id}`,
      provider: 'gphotos',
      name,
      path: `/${name}`,
      size: null,
      hash: null,
      hashAlgo: null,
      trashable: false,
      modifiedAt: created,
      kind: kindFromName(name),
      sampleKey: null,
      thumbnailUrl: baseUrl,
    });
  }
  return files;
}

/**
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function listDropboxFiles(accessToken, fetchImpl) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  /** @type {string | null} */
  let cursor = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore && pages < PAGE_LIMIT) {
    pages += 1;
    const url = cursor
      ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
      : 'https://api.dropboxapi.com/2/files/list_folder';
    const body = cursor
      ? { cursor }
      : { path: '', recursive: true, limit: 2000, include_deleted: false };
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new AppError('list_failed', 'Dropbox file list failed.', 502, { upstream: response.status });
    const data = await readJson(response);
    files.push(...parseDropboxEntries(data.entries));
    hasMore = Boolean(data.has_more);
    cursor = typeof data.cursor === 'string' ? data.cursor : null;
    if (hasMore && !cursor) break;
  }
  return files;
}

/**
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function listDriveFiles(accessToken, fetchImpl) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  /** @type {string | null} */
  let pageToken = null;
  let pages = 0;
  do {
    pages += 1;
    const params = new URLSearchParams({
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,md5Checksum,sha1Checksum,size,mimeType,trashed,modifiedTime,thumbnailLink)',
      q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new AppError('list_failed', 'Google Drive file list failed.', 502, { upstream: response.status });
    const data = await readJson(response);
    files.push(...parseDriveFiles(data.files));
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : null;
  } while (pageToken && pages < PAGE_LIMIT);
  return files;
}

/**
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function listOneDriveFiles(accessToken, fetchImpl) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  let next = 'https://graph.microsoft.com/v1.0/me/drive/root/delta?$select=id,name,size,file,folder,parentReference,deleted,lastModifiedDateTime&$top=200';
  let pages = 0;
  while (next && pages < PAGE_LIMIT) {
    pages += 1;
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new AppError('list_failed', 'OneDrive file list failed.', 502, { upstream: response.status });
    const data = await readJson(response);
    files.push(...parseOneDriveItems(data.value));
    next = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : '';
  }
  return files;
}

/**
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function listPhotoFiles(accessToken, fetchImpl) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  let next = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
  let pages = 0;
  while (next && pages < PAGE_LIMIT) {
    pages += 1;
    const response = await fetchImpl(next, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new AppError('list_failed', 'Google Photos list failed.', 502, { upstream: response.status });
    const data = await readJson(response);
    files.push(...parsePhotoItems(data.mediaItems));
    next = typeof data.nextPageToken === 'string'
      ? `https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100&pageToken=${encodeURIComponent(data.nextPageToken)}`
      : '';
  }
  return files;
}

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function listProviderFiles(provider, accessToken, fetchImpl) {
  if (provider === 'dropbox') return listDropboxFiles(accessToken, fetchImpl);
  if (provider === 'gdrive') return listDriveFiles(accessToken, fetchImpl);
  if (provider === 'onedrive') return listOneDriveFiles(accessToken, fetchImpl);
  if (provider === 'gphotos') return listPhotoFiles(accessToken, fetchImpl);
  throw new AppError('unknown_provider', 'Unknown provider.', 404);
}

/**
 * @param {import('./types.js').CloudFile} file
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function executeTrash(file, accessToken, fetchImpl) {
  const request = buildTrashRequest(file);
  const headers = { ...request.headers, Authorization: `Bearer ${accessToken}` };
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers,
    body: request.body,
  });
  if (!response.ok && response.status !== 204) {
    throw new AppError('trash_failed', 'The provider did not move the file to trash.', 502);
  }
  return { ok: true, action: 'trash', provider: file.provider, id: file.id };
}

/**
 * @param {string[]} mediaItemIds
 * @param {string} accessToken
 * @param {typeof fetch} fetchImpl
 */
export async function createReviewAlbum(mediaItemIds, accessToken, fetchImpl) {
  for (const id of mediaItemIds) assertItemId(id);
  const created = await fetchImpl('https://photoslibrary.googleapis.com/v1/albums', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ album: { title: REVIEW_ALBUM_TITLE } }),
  });
  if (!created.ok) return { albumCreated: false, added: false, albumId: null };
  const album = await readJson(created);
  if (!album || typeof album.id !== 'string') return { albumCreated: false, added: false, albumId: null };
  assertItemId(album.id);
  const added = await fetchImpl(
    `https://photoslibrary.googleapis.com/v1/albums/${encodeURIComponent(album.id)}:batchAddMediaItems`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mediaItemIds }),
    },
  );
  return { albumCreated: true, added: added.ok, albumId: album.id };
}

/**
 * Preview bytes only. Hosts are fixed or limited to Google thumbnail hosts.
 * @param {import('./types.js').CloudFile} file
 * @param {string} accessToken
 */
export function buildThumbnailRequest(file, accessToken) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  if (file.provider === 'dropbox') {
    assertDropboxPath(file.path);
    return {
      url: 'https://content.dropboxapi.com/2/files/get_thumbnail_v2',
      method: 'POST',
      headers: {
        ...auth,
        'Dropbox-API-Arg': JSON.stringify({
          resource: { '.tag': 'path', path: file.path },
          format: 'jpeg',
          size: 'w256h256',
          mode: 'strict',
        }),
      },
      body: undefined,
    };
  }
  if (file.provider === 'onedrive') {
    const { localId } = splitCompositeId(file.id);
    assertItemId(localId);
    return {
      url: `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(localId)}/thumbnails/0/medium/content`,
      method: 'GET',
      headers: auth,
      body: undefined,
    };
  }
  if (file.provider === 'gdrive' || file.provider === 'gphotos') {
    const previewUrl = assertPreviewUrl(file.thumbnailUrl);
    const url = file.provider === 'gphotos' && !previewUrl.includes('=')
      ? `${previewUrl}=w256-h256`
      : previewUrl;
    return { url, method: 'GET', headers: auth, body: undefined };
  }
  throw new AppError('unknown_provider', 'Unknown provider.', 404);
}

/**
 * @param {string | null} raw
 * @returns {string}
 */
function assertPreviewUrl(raw) {
  if (!raw) throw new AppError('no_preview', 'This file has no image preview.', 404);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('no_preview', 'This file has no image preview.', 404);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AppError('no_preview', 'This file has no image preview.', 404);
  }
  const host = url.hostname;
  const allowed = host === 'lh3.googleusercontent.com'
    || host === 'lh4.googleusercontent.com'
    || host === 'lh5.googleusercontent.com'
    || host === 'lh6.googleusercontent.com'
    || host.endsWith('.googleusercontent.com');
  if (!allowed) throw new AppError('no_preview', 'This file has no image preview.', 404);
  return url.toString();
}
