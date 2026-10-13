// @ts-check

/** @type {import('./types.js').ProviderId[]} */
export const PROVIDER_IDS = ['dropbox', 'onedrive', 'gdrive', 'gphotos'];

export const PHOTOS_MANUAL_STEPS = [
  'Open the Google Photos app or photos.google.com.',
  'Search for the file name shown in this group.',
  'Move the extra copies to Google Photos trash yourself. The Photos Library API cannot trash or delete library items.',
  'Items stay in Google Photos trash for 60 days before Google removes them.',
];

export const REVIEW_ALBUM_TITLE = 'Duplicate review';

/**
 * @typedef {Object} ProviderInfo
 * @property {import('./types.js').ProviderId} id
 * @property {string} name
 * @property {string} blurb
 * @property {boolean} trashable
 * @property {string} trashMethod
 * @property {string[]} readScopes
 * @property {string[]} trashScopes
 * @property {string[]} albumScopes
 * @property {string[]} refreshScopes
 * @property {string} scopeNote
 */

/** @type {ProviderInfo[]} */
export const PROVIDERS = [
  {
    id: 'dropbox',
    name: 'Dropbox',
    blurb: 'Content hash from file metadata.',
    trashable: true,
    trashMethod: 'files/delete_v2 moves the file to Dropbox deleted files, where it can be restored for 30 days.',
    readScopes: ['files.metadata.read'],
    trashScopes: ['files.content.write'],
    albumScopes: [],
    refreshScopes: [],
    scopeNote: 'Scanning uses files.metadata.read so the app can list names, sizes, and content hashes. It does not request files.content.read and does not download file bytes. Moving a file to trash needs files.content.write, and that scope is requested only after you confirm.',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    blurb: 'SHA-1 or quickXor when Microsoft provides it, otherwise name and size.',
    trashable: true,
    trashMethod: 'DELETE /me/drive/items/{id} moves the file to the OneDrive recycle bin. permanentDelete is never called.',
    readScopes: ['Files.Read'],
    trashScopes: ['Files.ReadWrite'],
    albumScopes: [],
    refreshScopes: ['offline_access'],
    scopeNote: 'Scanning uses Files.Read on your own drive, not Files.ReadWrite.All. Trash access is Files.ReadWrite and is requested only after you confirm. offline_access lets the server refresh the session. The permanentDelete endpoint is refused.',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    blurb: 'MD5, or SHA-1 if that is all Drive returns.',
    trashable: true,
    trashMethod: 'files.update with trashed:true. files.delete is refused because it permanently deletes.',
    readScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    trashScopes: ['https://www.googleapis.com/auth/drive'],
    albumScopes: [],
    refreshScopes: [],
    scopeNote: 'Scanning uses drive.readonly. Google has no trash-only scope, and drive.file cannot see files this app did not create, so trashing existing files requires the drive scope. That scope is requested only after you confirm. The app sends trashed:true and refuses files.delete.',
  },
  {
    id: 'gphotos',
    name: 'Google Photos',
    blurb: 'No content hash. Name and size are used only when Photos provides a size.',
    trashable: false,
    trashMethod: 'The Photos Library API cannot trash items. The app flags them and can add them to a review album.',
    readScopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
    trashScopes: [],
    albumScopes: ['https://www.googleapis.com/auth/photoslibrary.appendonly'],
    refreshScopes: [],
    scopeNote: 'Scanning uses photoslibrary.readonly. There is no delete scope because the API cannot trash library items. photoslibrary.appendonly is requested only if you add items to a review album, and the album does not delete them.',
  },
];

/**
 * @param {string} id
 * @returns {ProviderInfo | null}
 */
export function getProvider(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

/**
 * @param {ProviderInfo} provider
 * @param {import('./types.js').OAuthPurpose} purpose
 * @returns {string[] | null}
 */
export function scopesForPurpose(provider, purpose) {
  if (purpose === 'connect') {
    return [...provider.readScopes, ...provider.refreshScopes];
  }
  if (purpose === 'trash') {
    if (provider.trashScopes.length === 0) return null;
    return [...provider.readScopes, ...provider.trashScopes, ...provider.refreshScopes];
  }
  if (purpose === 'album') {
    if (provider.albumScopes.length === 0) return null;
    return [...provider.readScopes, ...provider.albumScopes, ...provider.refreshScopes];
  }
  return null;
}

/**
 * @param {string} value
 * @returns {value is import('./types.js').OAuthPurpose}
 */
export function isPurpose(value) {
  return value === 'connect' || value === 'trash' || value === 'album';
}

/**
 * @param {ProviderInfo} provider
 * @param {boolean} connected
 * @param {string[]} scopes
 */
export function presentProvider(provider, connected, scopes) {
  return {
    id: provider.id,
    name: provider.name,
    blurb: provider.blurb,
    connected,
    trashable: provider.trashable,
    trashMethod: provider.trashMethod,
    readScopes: provider.readScopes,
    trashScopes: provider.trashScopes,
    albumScopes: provider.albumScopes,
    grantedScopes: connected ? scopes : [],
    scopeNote: provider.scopeNote,
  };
}
