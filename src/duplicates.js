// @ts-check
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

/**
 * @param {import('./types.js').CloudFile[]} files
 * @returns {import('./types.js').DuplicateGroup[]}
 */
export function findDuplicates(files) {
  /** @type {Map<string, import('./types.js').CloudFile[]>} */
  const content = new Map();
  /** @type {Map<string, import('./types.js').CloudFile[]>} */
  const weak = new Map();

  for (const file of files) {
    const hash = typeof file.hash === 'string' ? file.hash.trim() : '';
    if (hash && file.hashAlgo) {
      const key = `content:${file.hashAlgo}:${hash}`;
      const list = content.get(key) || [];
      list.push(file);
      content.set(key, list);
      continue;
    }
    if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0 && file.name.trim()) {
      const key = `weak:${file.size}:${file.name.trim().toLowerCase()}`;
      const list = weak.get(key) || [];
      list.push(file);
      weak.set(key, list);
    }
  }

  /** @type {import('./types.js').DuplicateGroup[]} */
  const groups = [];
  for (const [key, list] of content) {
    if (list.length > 1) groups.push(toGroup(key, 'content', list));
  }
  for (const [key, list] of weak) {
    if (list.length > 1) groups.push(toGroup(key, 'weak', list));
  }
  groups.sort((a, b) => (b.wastedBytes || 0) - (a.wastedBytes || 0) || b.count - a.count);
  return groups;
}

/**
 * @param {string} key
 * @param {import('./types.js').MatchKind} match
 * @param {import('./types.js').CloudFile[]} files
 * @returns {import('./types.js').DuplicateGroup}
 */
function toGroup(key, match, files) {
  const sizes = files.map((file) => file.size);
  const sameSize = sizes.every((size) => size === sizes[0] && typeof size === 'number');
  const hashed = files[0];
  return {
    id: createHash('sha256').update(key).digest('hex').slice(0, 16),
    match,
    hashAlgo: match === 'content' ? hashed.hashAlgo : null,
    hash: match === 'content' ? hashed.hash : null,
    count: files.length,
    size: sameSize ? /** @type {number} */ (sizes[0]) : null,
    wastedBytes: wastedBytes(files),
    files,
  };
}

/**
 * @param {import('./types.js').CloudFile[]} files
 */
export function wastedBytes(files) {
  if (files.some((file) => typeof file.size !== 'number')) return null;
  const sizes = /** @type {number[]} */ (files.map((file) => file.size));
  const keep = Math.max(...sizes);
  return sizes.reduce((sum, size) => sum + size, 0) - keep;
}

/**
 * Files the user asked to trash, checked against the last scan.
 * Refuses to remove the last copy in a group and refuses Google Photos.
 * @param {import('./types.js').DuplicateGroup[]} groups
 * @param {string[]} ids
 */
export function planTrash(groups, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    throw new AppError('nothing_selected', 'Select at least one duplicate to move to trash.', 400);
  }
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    throw new AppError('nothing_selected', 'Each file can be selected only once.', 400);
  }
  const known = new Map(groups.flatMap((group) => group.files.map((file) => [file.id, file])));
  for (const id of idSet) {
    if (!known.has(id)) {
      throw new AppError('unknown_file', 'That file is not in the latest scan. Scan again.', 400);
    }
  }

  /** @type {import('./types.js').CloudFile[]} */
  const planned = [];
  for (const group of groups) {
    const selected = group.files.filter((file) => idSet.has(file.id));
    if (selected.length === 0) continue;
    if (selected.length >= group.files.length) {
      throw new AppError('must_keep_one', 'Leave at least one copy in each duplicate group.', 400);
    }
    const blocked = selected.filter((file) => !file.trashable || file.provider === 'gphotos');
    if (blocked.length > 0) {
      throw new AppError(
        'photos_cannot_trash',
        'Google Photos items cannot be moved to trash by the API. Add them to a review album or trash them in Google Photos.',
        409,
      );
    }
    planned.push(...selected);
  }
  if (planned.length === 0) {
    throw new AppError('nothing_selected', 'Select at least one duplicate to move to trash.', 400);
  }
  return planned;
}

/**
 * @param {import('./types.js').DuplicateGroup} group
 */
export function presentGroup(group) {
  return {
    id: group.id,
    match: group.match,
    hashAlgo: group.hashAlgo,
    hashPreview: group.hash ? group.hash.slice(0, 12) : null,
    count: group.count,
    size: group.size,
    wastedBytes: group.wastedBytes,
    files: group.files.map((file) => ({
      id: file.id,
      provider: file.provider,
      name: file.name,
      path: file.path,
      size: file.size,
      trashable: file.trashable,
    })),
  };
}
