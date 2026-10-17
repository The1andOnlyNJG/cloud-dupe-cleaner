// @ts-check
import { AppError } from './errors.js';
import { REVIEW_ALBUM_TITLE } from './catalog.js';
import { kindFromName } from './media.js';

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string} localId
 * @param {string} name
 * @param {string} path
 * @param {number | null} size
 * @param {string | null} hash
 * @param {import('./types.js').HashAlgo | null} hashAlgo
 * @param {{ modifiedAt?: string | null, sampleKey?: string | null }} [extra]
 * @returns {import('./types.js').CloudFile}
 */
export function cloudFile(provider, localId, name, path, size, hash, hashAlgo, extra = {}) {
  return {
    id: `${provider}:${localId}`,
    provider,
    name,
    path,
    size,
    hash,
    hashAlgo,
    trashable: provider !== 'gphotos',
    modifiedAt: extra.modifiedAt || null,
    kind: kindFromName(name),
    sampleKey: extra.sampleKey || null,
    thumbnailUrl: null,
  };
}

/** @returns {import('./types.js').CloudFile[]} */
export function seedFiles() {
  return [
    cloudFile('dropbox', 'dbx-holiday-a', 'holiday.jpg', '/Photos/2024/holiday.jpg', 2400000, 'c0ffeeholiday', 'dropbox-content-hash', { modifiedAt: '2024-07-12T15:04:00.000Z', sampleKey: 'holiday' }),
    cloudFile('dropbox', 'dbx-holiday-b', 'holiday-copy.jpg', '/Photos/2024/copies/holiday-copy.jpg', 2400000, 'c0ffeeholiday', 'dropbox-content-hash', { modifiedAt: '2024-08-02T09:18:00.000Z', sampleKey: 'holiday' }),
    cloudFile('gdrive', 'drv-nda-a', 'nda.pdf', 'Contracts/nda.pdf', 88000, '0a11ce0a', 'md5', { modifiedAt: '2023-11-03T18:00:00.000Z' }),
    cloudFile('gdrive', 'drv-nda-b', 'nda-final.pdf', 'Contracts/archive/nda-final.pdf', 88000, '0a11ce0a', 'md5', { modifiedAt: '2024-01-19T11:40:00.000Z' }),
    cloudFile('onedrive', 'od-budget-a', 'budget.xlsx', '/Documents/budget.xlsx', 56000, 'a1b2c3d4e5f60789', 'sha1', { modifiedAt: '2024-03-01T08:12:00.000Z' }),
    cloudFile('onedrive', 'od-budget-b', 'budget (1).xlsx', '/Documents/budget (1).xlsx', 56000, 'a1b2c3d4e5f60789', 'sha1', { modifiedAt: '2024-03-01T08:40:00.000Z' }),
    cloudFile('onedrive', 'od-notes-a', 'notes.txt', '/Notes/notes.txt', 4096, null, null, { modifiedAt: '2024-05-22T16:05:00.000Z' }),
    cloudFile('onedrive', 'od-notes-b', 'notes.txt', '/Backup/notes.txt', 4096, null, null, { modifiedAt: '2024-06-01T07:55:00.000Z' }),
    cloudFile('gphotos', 'ph-img-a', 'IMG_2048.JPG', '/IMG_2048.JPG', 3100000, null, null, { modifiedAt: '2024-09-14T13:22:00.000Z', sampleKey: 'camera' }),
    cloudFile('gphotos', 'ph-img-b', 'IMG_2048.JPG', '/Albums/Camera/IMG_2048.JPG', 3100000, null, null, { modifiedAt: '2024-09-14T13:22:00.000Z', sampleKey: 'camera' }),
    cloudFile('dropbox', 'dbx-unique', 'readme.txt', '/readme.txt', 1280, 'deadbeef', 'dropbox-content-hash'),
    cloudFile('gphotos', 'ph-nosize', 'clip.mp4', '/clip.mp4', null, null, null),
    cloudFile('onedrive', 'od-qx-a', 'reel.mov', '/Video/reel.mov', 900000, 'qxhash123', 'quickXor'),
    cloudFile('onedrive', 'od-qx-b', 'reel-copy.mov', '/Video/copies/reel-copy.mov', 900000, 'qxhash123', 'quickXor'),
  ];
}

/** @returns {import('./types.js').MockState} */
export function createMockState() {
  return { files: seedFiles(), trash: [], albums: [] };
}

/**
 * @param {import('./types.js').MockState} state
 * @param {import('./types.js').CloudFile} file
 */
export function mockTrash(state, file) {
  if (file.provider === 'gphotos' || !file.trashable) {
    throw new AppError(
      'photos_cannot_trash',
      'Google Photos items cannot be moved to trash by the API.',
      409,
    );
  }
  const index = state.files.findIndex((item) => item.id === file.id);
  if (index === -1) {
    throw new AppError('not_found', 'That file is no longer available.', 404);
  }
  const [removed] = state.files.splice(index, 1);
  state.trash.push(removed);
  return { ok: true, action: 'trash', provider: file.provider };
}

/**
 * @param {import('./types.js').MockState} state
 * @param {import('./types.js').CloudFile[]} files
 */
export function mockAddToAlbum(state, files) {
  const photos = files.filter((file) => file.provider === 'gphotos');
  if (photos.length === 0) {
    throw new AppError('no_photos', 'Choose Google Photos items to add to the review album.', 400);
  }
  const album = {
    id: `album-${state.albums.length + 1}`,
    title: REVIEW_ALBUM_TITLE,
    mediaItemIds: photos.map((file) => file.id),
  };
  state.albums.push(album);
  return album;
}

/**
 * @param {string} id
 * @returns {{ provider: string, localId: string }}
 */
export function splitCompositeId(id) {
  const index = id.indexOf(':');
  if (index <= 0 || index === id.length - 1) {
    throw new AppError('unknown_file', 'File id was not recognized.', 400);
  }
  return { provider: id.slice(0, index), localId: id.slice(index + 1) };
}
