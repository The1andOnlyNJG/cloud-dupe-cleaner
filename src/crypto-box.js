// @ts-check
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * @param {unknown} value
 * @param {Buffer} key
 */
export function encryptJson(value, key) {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * @param {string} payload
 * @param {Buffer} key
 * @returns {any}
 */
export function decryptJson(payload, key) {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes.');
  }
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Encrypted payload is not valid.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Encrypted payload is not valid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * @param {string} value
 * @param {Buffer} key
 */
export function ciphertextContains(value, key) {
  return encryptJson({ token: value }, key).includes(value);
}
