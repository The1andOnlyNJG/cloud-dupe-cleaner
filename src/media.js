// @ts-check

/** @typedef {import('./types.js').FileKind} FileKind */

/**
 * @param {string} name
 * @returns {FileKind}
 */
export function kindFromName(name) {
  const ext = String(name).split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['txt', 'md', 'rtf'].includes(ext)) return 'text';
  return 'other';
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function asIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

/**
 * @param {string | null | undefined} key
 */
export function safeSampleKey(key) {
  if (!key || !/^[a-z0-9]+$/.test(key)) return null;
  return key;
}
