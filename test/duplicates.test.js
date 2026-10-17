// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { findDuplicates, planTrash } from '../src/duplicates.js';
import { cloudFile } from '../src/mock-cloud.js';
import { AppError } from '../src/errors.js';

test('groups content hashes only within the same algorithm', () => {
  const files = [
    cloudFile('dropbox', 'a', 'one.bin', '/one.bin', 10, 'same', 'dropbox-content-hash'),
    cloudFile('dropbox', 'b', 'two.bin', '/two.bin', 10, 'same', 'dropbox-content-hash'),
    cloudFile('gdrive', 'c', 'three.bin', 'three.bin', 10, 'same', 'md5'),
  ];
  const groups = findDuplicates(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].match, 'content');
  assert.equal(groups[0].hashAlgo, 'dropbox-content-hash');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].wastedBytes, 10);
});

test('falls back to size and name only when no content hash exists', () => {
  const files = [
    cloudFile('onedrive', 'a', 'Notes.TXT', '/a/Notes.TXT', 40, null, null),
    cloudFile('onedrive', 'b', 'notes.txt', '/b/notes.txt', 40, null, null),
    cloudFile('gdrive', 'c', 'notes.txt', 'notes.txt', 40, 'abc', 'md5'),
    cloudFile('gdrive', 'd', 'other.txt', 'other.txt', 40, null, null),
    cloudFile('gphotos', 'e', 'clip.mp4', '/clip.mp4', null, null, null),
  ];
  const groups = findDuplicates(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].match, 'weak');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].hash, null);
});

test('quickXor and sha1 are content matches, not name matches', () => {
  const files = [
    cloudFile('onedrive', 'a', 'reel.mov', '/reel.mov', 5, 'qx', 'quickXor'),
    cloudFile('onedrive', 'b', 'reel-copy.mov', '/copy.mov', 5, 'qx', 'quickXor'),
  ];
  const groups = findDuplicates(files);
  assert.equal(groups[0].match, 'content');
  assert.equal(groups[0].hashAlgo, 'quickXor');
});

test('trash planning keeps one copy and refuses photos', () => {
  const files = [
    cloudFile('dropbox', 'a', 'a.jpg', '/a.jpg', 3, 'h', 'dropbox-content-hash'),
    cloudFile('dropbox', 'b', 'b.jpg', '/b.jpg', 3, 'h', 'dropbox-content-hash'),
    cloudFile('gphotos', 'c', 'a.jpg', '/a.jpg', 9, null, null),
    cloudFile('gphotos', 'd', 'a.jpg', '/d.jpg', 9, null, null),
  ];
  const groups = findDuplicates(files);
  const content = groups.find((group) => group.match === 'content');
  const weak = groups.find((group) => group.match === 'weak');
  assert.ok(content && weak);
  assert.equal(planTrash(groups, [content.files[1].id]).length, 1);
  assert.throws(() => planTrash(groups, content.files.map((file) => file.id)), (error) => error instanceof AppError && error.code === 'must_keep_one');
  assert.throws(() => planTrash(groups, [weak.files[1].id]), (error) => error instanceof AppError && error.code === 'photos_cannot_trash');
  assert.throws(() => planTrash(groups, ['missing']), (error) => error instanceof AppError && error.code === 'unknown_file');
  assert.throws(() => planTrash(groups, []), (error) => error instanceof AppError && error.code === 'nothing_selected');
});
