// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import {
  assertSafeTrashRequest,
  buildTrashRequest,
  parseDriveFiles,
  parseDropboxEntries,
  parseOneDriveItems,
  parsePhotoItems,
} from '../src/provider-api.js';
import { cloudFile } from '../src/mock-cloud.js';

test('provider parsers keep the hash the service actually returns', () => {
  const dropbox = parseDropboxEntries([
    { '.tag': 'file', id: 'id:1', name: 'a.txt', path_display: '/a.txt', size: 4, content_hash: 'dbxhash' },
    { '.tag': 'folder', id: 'id:2', name: 'folder' },
  ]);
  assert.equal(dropbox[0].hashAlgo, 'dropbox-content-hash');
  assert.equal(dropbox[0].hash, 'dbxhash');
  assert.equal(dropbox.length, 1);

  const drive = parseDriveFiles([
    { id: 'd1', name: 'a.pdf', md5Checksum: 'abc', size: '12', mimeType: 'application/pdf' },
    { id: 'd2', name: 'sheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
    { id: 'd3', name: 'gone', md5Checksum: 'zzz', trashed: true },
  ]);
  assert.equal(drive[0].hashAlgo, 'md5');
  assert.equal(drive[1].hash, null);
  assert.equal(drive.some((file) => file.name === 'gone'), false);

  const one = parseOneDriveItems([
    { id: 'o1', name: 'a', size: 8, file: { hashes: { sha1Hash: 'sha' } }, parentReference: { path: '/drive/root:/Docs' } },
    { id: 'o2', name: 'b', size: 8, file: { hashes: { quickXorHash: 'qx' } } },
    { id: 'o3', name: 'c', size: 8, file: {}, folder: { childCount: 0 } },
  ]);
  assert.deepEqual(one.map((file) => file.hashAlgo), ['sha1', 'quickXor']);
  assert.equal(one[0].path, '/Docs/a');

  const photos = parsePhotoItems([{ id: 'p1', filename: 'IMG.jpg' }]);
  assert.equal(photos[0].hash, null);
  assert.equal(photos[0].size, null);
  assert.equal(photos[0].trashable, false);
});

test('trash requests are recoverable and photos cannot be trashed', () => {
  const dropbox = buildTrashRequest(cloudFile('dropbox', '1', 'a', '/Docs/a.txt', 1, 'h', 'dropbox-content-hash'));
  assert.equal(dropbox.url, 'https://api.dropboxapi.com/2/files/delete_v2');
  assert.equal(dropbox.method, 'POST');
  assert.equal(dropbox.url.includes('permanently_delete'), false);

  const drive = buildTrashRequest(cloudFile('gdrive', 'file-1', 'a', 'a', 1, 'h', 'md5'));
  assert.equal(drive.method, 'PATCH');
  assert.equal(drive.url, 'https://www.googleapis.com/drive/v3/files/file-1');
  assert.equal(drive.body, JSON.stringify({ trashed: true }));

  const one = buildTrashRequest(cloudFile('onedrive', 'item-1', 'a', '/a', 1, null, null));
  assert.equal(one.method, 'DELETE');
  assert.equal(one.url, 'https://graph.microsoft.com/v1.0/me/drive/items/item-1');
  assert.equal(one.url.toLowerCase().includes('permanentdelete'), false);

  assert.throws(
    () => buildTrashRequest(cloudFile('gphotos', 'p1', 'a.jpg', '/a.jpg', 1, null, null)),
    (error) => error instanceof AppError && error.code === 'photos_cannot_trash',
  );
  assert.throws(
    () => assertSafeTrashRequest({ url: 'https://www.googleapis.com/drive/v3/files/abc', method: 'DELETE' }),
    (error) => error instanceof AppError && error.code === 'hard_delete_forbidden',
  );
  assert.throws(
    () => assertSafeTrashRequest({ url: 'https://graph.microsoft.com/v1.0/me/drive/items/abc/permanentDelete', method: 'POST' }),
    (error) => error instanceof AppError && error.code === 'hard_delete_forbidden',
  );
  assert.throws(() => buildTrashRequest(cloudFile('dropbox', '1', 'a', '/ok/../../etc/passwd', 1, null, null)));
});
