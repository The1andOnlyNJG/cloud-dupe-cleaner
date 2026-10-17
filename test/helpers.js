// @ts-check
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/** @returns {Promise<number>} */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * @param {number} port
 * @param {NodeJS.ProcessEnv} [env]
 */
export function demoConfig(port, env = {}) {
  return loadConfig({
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    MOCK_PROVIDERS: 'true',
    PERSIST_TOKENS: 'false',
    SESSION_SIGNING_KEY: Buffer.alloc(32, 3).toString('base64'),
    ...env,
  });
}

/**
 * @param {string} base
 */
export function createApi(base) {
  let cookie = '';
  /**
   * @param {string} path
   * @param {{ method?: string, body?: Record<string, unknown>, csrf?: string }} [options]
   */
  return async function request(path, options = {}) {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (options.csrf) headers.set('x-csrf-token', options.csrf);
    if (options.body) headers.set('content-type', 'application/json');
    const response = await fetch(base + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const item of cookies) {
      const pair = item.split(';')[0];
      if (pair.startsWith('sid=')) cookie = pair;
    }
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : null;
    return { response, data: /** @type {any} */ (data), cookie };
  };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, sessions?: NonNullable<Parameters<typeof createApp>[0]['sessions']> }} options
 * @param {(ctx: { base: string, api: ReturnType<typeof createApi>, config: import('../src/types.js').AppConfig }) => Promise<void>} run
 */
export async function withServer(options, run) {
  const port = await freePort();
  const config = demoConfig(port, options.env);
  const app = createApp({
    config,
    fetchImpl: options.fetchImpl,
    rateLimit: false,
    sessions: options.sessions,
  });
  const server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run({ base: config.publicBase, api: createApi(config.publicBase), config });
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
}

/**
 * @param {ReturnType<typeof createApi>} api
 * @param {string} provider
 * @param {string} [purpose]
 */
export async function connectProvider(api, provider, purpose = 'connect') {
  const start = await api(`/auth/${provider}/start?purpose=${purpose}`);
  const location = start.response.headers.get('location');
  if (!location) throw new Error('missing redirect');
  const url = new URL(location, 'http://127.0.0.1');
  return api(`${url.pathname}${url.search}`);
}
