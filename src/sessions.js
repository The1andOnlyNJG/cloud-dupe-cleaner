// @ts-check
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decryptJson, encryptJson } from './crypto-box.js';
import { createMockState } from './mock-cloud.js';
import { safeEqual } from './oauth.js';

/**
 * @param {{ persist: boolean, filePath: string, key: Buffer | null }} options
 */
export function createSessionStore(options) {
  /** @type {Map<string, import('./types.js').SessionData>} */
  const map = new Map();

  if (options.persist && options.key && existsSync(options.filePath)) {
    try {
      const parsed = decryptJson(readFileSync(options.filePath, 'utf8'), options.key);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, data] of Object.entries(parsed)) {
          if (data && typeof data === 'object' && 'csrf' in data && typeof data.csrf === 'string') {
            map.set(id, /** @type {import('./types.js').SessionData} */ (data));
          }
        }
      }
    } catch {
      console.error('Token vault could not be decrypted. Starting with an empty session store.');
    }
  }

  function flush() {
    if (!options.persist || !options.key) return;
    /** @type {Record<string, import('./types.js').SessionData>} */
    const sessions = {};
    for (const [id, data] of map) sessions[id] = data;
    const dir = path.dirname(options.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(options.filePath, encryptJson(sessions, options.key), { mode: 0o600 });
    chmodSync(options.filePath, 0o600);
    if (dir !== '/tmp' && dir !== '/var/tmp') chmodSync(dir, 0o700);
  }

  return {
    create() {
      const id = randomBytes(32).toString('base64url');
      const data = freshSession();
      map.set(id, data);
      flush();
      return { id, data };
    },
    /** @param {string} id */
    get(id) {
      return map.get(id) || null;
    },
    /** @param {string} oldId */
    rotate(oldId) {
      const data = map.get(oldId);
      if (!data) return null;
      map.delete(oldId);
      const id = randomBytes(32).toString('base64url');
      map.set(id, data);
      flush();
      return { id, data };
    },
    /** @param {string} id */
    delete(id) {
      map.delete(id);
      flush();
    },
    flush,
  };
}

/** @returns {import('./types.js').SessionData} */
function freshSession() {
  return {
    csrf: randomBytes(32).toString('base64url'),
    providers: {},
    oauth: {},
    scan: null,
    mock: createMockState(),
  };
}

/**
 * @param {string} id
 * @param {Buffer} key
 */
export function signSessionId(id, key) {
  const mac = createHmac('sha256', key).update(id).digest('base64url');
  return `${id}.${mac}`;
}

/**
 * @param {string} signed
 * @param {Buffer} key
 */
export function verifySessionId(signed, key) {
  const index = signed.lastIndexOf('.');
  if (index <= 0) return null;
  const id = signed.slice(0, index);
  const mac = signed.slice(index + 1);
  const expected = createHmac('sha256', key).update(id).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  return id;
}

/**
 * @param {string | undefined} header
 * @param {string} name
 */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
