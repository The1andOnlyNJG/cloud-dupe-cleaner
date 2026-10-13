// @ts-check
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

const OAUTH_TTL_MS = 10 * 60 * 1000;

/**
 * @param {string} left
 * @param {string} right
 */
export function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createState() {
  return randomBytes(32).toString('base64url');
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: /** @type {const} */ ('S256') };
}

/**
 * @param {string} redirectUri
 * @param {readonly string[]} allowlist
 */
export function normalizeRedirect(redirectUri, allowlist) {
  if (typeof redirectUri !== 'string') {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  const raw = redirectUri.trim();
  if (raw.length === 0 || raw.length > 300 || /[\s\\@]/.test(raw) || raw.includes('..')) {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  const normalized = `${url.origin}${url.pathname}`;
  if (normalized !== raw || !allowlist.includes(normalized)) {
    throw new AppError('redirect_rejected', 'Redirect URL was rejected.', 400);
  }
  return normalized;
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {string} provider
 * @param {string} state
 * @param {number} [now]
 * @returns {import('./types.js').OAuthTxn}
 */
export function consumeOAuthTransaction(session, provider, state, now = Date.now()) {
  const pending = session.oauth[provider];
  delete session.oauth[provider];
  if (!pending) {
    throw new AppError('invalid_state', 'The sign-in session did not match. Start again.', 400);
  }
  if (!Number.isFinite(pending.createdAt) || now - pending.createdAt > OAUTH_TTL_MS) {
    throw new AppError('expired', 'The sign-in attempt expired. Start again.', 400);
  }
  if (pending.provider !== provider || !safeEqual(pending.state, String(state || ''))) {
    throw new AppError('invalid_state', 'The sign-in session did not match. Start again.', 400);
  }
  return pending;
}

/**
 * @param {string[]} granted
 * @param {string[]} required
 */
export function missingScopes(granted, required) {
  const have = new Set(granted);
  return required.filter((scope) => !have.has(scope));
}

export { OAUTH_TTL_MS };
