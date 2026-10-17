// @ts-check
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PROVIDER_IDS } from './catalog.js';

/**
 * Load KEY=VALUE pairs from a gitignored env file without overriding the process environment.
 * @param {string} [file]
 */
export function loadEnvFile(file = '.env') {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(index + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} required
 * @param {string} name
 */
function loadKey(env, required, name) {
  const raw = env[name];
  if (typeof raw === 'string' && raw.trim()) {
    const key = Buffer.from(raw.trim(), 'base64');
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded.`);
    return { key, ephemeral: false };
  }
  if (required) throw new Error(`${name} is required.`);
  return { key: /** @type {Buffer | null} */ (null), ephemeral: true };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./types.js').AppConfig}
 */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
  const host = env.HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '0.0.0.0') {
    throw new Error('HOST must be 127.0.0.1, localhost, or 0.0.0.0.');
  }
  const publicBase = (env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  let baseUrl;
  try {
    baseUrl = new URL(publicBase);
  } catch {
    throw new Error('PUBLIC_BASE_URL is invalid.');
  }
  if ((baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('PUBLIC_BASE_URL must be an http(s) origin without credentials or a query.');
  }
  if (production && env.MOCK_PROVIDERS !== 'true' && env.MOCK_PROVIDERS !== 'false') {
    throw new Error('MOCK_PROVIDERS must be true or false when NODE_ENV=production.');
  }
  if (production && env.PERSIST_TOKENS !== 'true' && env.PERSIST_TOKENS !== 'false') {
    throw new Error('PERSIST_TOKENS must be true or false when NODE_ENV=production.');
  }

  const mock = env.MOCK_PROVIDERS === 'false' ? false : env.MOCK_PROVIDERS === 'true' ? true : !production;
  const persist = env.PERSIST_TOKENS === 'true';
  const signing = loadKey(env, production, 'SESSION_SIGNING_KEY');
  const token = loadKey(env, Boolean(production && persist), 'TOKEN_ENCRYPTION_KEY');
  if (persist && !token.key) throw new Error('PERSIST_TOKENS=true requires TOKEN_ENCRYPTION_KEY.');

  return {
    production,
    port,
    host,
    publicBase,
    mock,
    persist,
    signingKey: signing.key || randomBytes(32),
    signingKeyEphemeral: !signing.key,
    tokenKey: token.key,
    tokenKeyEphemeral: !token.key,
    allowedRedirects: PROVIDER_IDS.map((id) => `${publicBase}/auth/${id}/callback`),
    clients: {
      dropbox: { id: env.DROPBOX_CLIENT_ID || '', secret: env.DROPBOX_CLIENT_SECRET || '' },
      onedrive: { id: env.MICROSOFT_CLIENT_ID || '', secret: env.MICROSOFT_CLIENT_SECRET || '' },
      gdrive: { id: env.GOOGLE_CLIENT_ID || '', secret: env.GOOGLE_CLIENT_SECRET || '' },
      gphotos: { id: env.GOOGLE_CLIENT_ID || '', secret: env.GOOGLE_CLIENT_SECRET || '' },
    },
    dataDir: env.DATA_DIR || 'data',
  };
}
