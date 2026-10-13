// @ts-check
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { AppError } from './errors.js';
import {
  PHOTOS_MANUAL_STEPS,
  PROVIDER_IDS,
  PROVIDERS,
  REVIEW_ALBUM_TITLE,
  getProvider,
  isPurpose,
  presentProvider,
  scopesForPurpose,
} from './catalog.js';
import { findDuplicates, planTrash, presentGroup } from './duplicates.js';
import { mockAddToAlbum, mockTrash, splitCompositeId } from './mock-cloud.js';
import { consumeOAuthTransaction, createPkce, createState, missingScopes, normalizeRedirect, safeEqual } from './oauth.js';
import {
  buildAuthorizeUrl,
  buildRefreshRequest,
  buildTokenRequest,
  createReviewAlbum,
  buildThumbnailRequest,
  executeTrash,
  listProviderFiles,
} from './provider-api.js';
import { safeSampleKey } from './media.js';
import { createRateLimiter } from './rate-limit.js';
import { createSessionStore, readCookie, signSessionId, verifySessionId } from './sessions.js';

const TRASH_CONFIRMATION = 'MOVE_TO_TRASH';
const ALBUM_CONFIRMATION = 'ADD_TO_REVIEW_ALBUM';
const SAFE_ERRORS = new Set(['access_denied', 'invalid_state', 'expired', 'token_exchange', 'not_configured']);

/**
 * @typedef {import('express').Request & {
 *   session: import('./types.js').SessionData,
 *   sessionId: string,
 *   rotateSession: () => void,
 * }} AuthedRequest
 */

/**
 * @param {unknown} value
 */
function routeParam(value) {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

/**
 * @param {import('express').Response} res
 * @param {string} signed
 * @param {import('./types.js').AppConfig} config
 */
function setSessionCookie(res, signed, config) {
  const parts = [
    `sid=${encodeURIComponent(signed)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (config.publicBase.startsWith('https://')) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * @param {string} code
 */
function safeError(code) {
  return SAFE_ERRORS.has(code) ? code : 'token_exchange';
}

/**
 * @param {import('./types.js').ProviderId} provider
 * @param {string[]} scopes
 * @returns {import('./types.js').ProviderToken}
 */
function issueMockToken(provider, scopes) {
  return {
    accessToken: `mock-access.${provider}.${randomBytes(18).toString('base64url')}`,
    refreshToken: null,
    scopes: [...scopes],
    obtainedAt: Date.now(),
  };
}

/**
 * @param {(req: AuthedRequest, res: import('express').Response) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(/** @type {AuthedRequest} */ (req), res)).catch(next);
  };
}

/**
 * @param {import('./types.js').SessionData} session
 */
function connectedProviders(session) {
  return PROVIDERS.map((provider) => {
    const token = session.providers[provider.id];
    return presentProvider(provider, Boolean(token), token ? token.scopes : []);
  });
}

/**
 * @param {import('./types.js').AppConfig} config
 * @param {import('./types.js').ProviderId} provider
 * @param {import('./types.js').OAuthTxn} txn
 * @param {string} code
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<import('./types.js').ProviderToken>}
 */
async function exchangeCode(config, provider, txn, code, fetchImpl) {
  const client = config.clients[provider];
  if (!client.id) throw new AppError('not_configured', 'Set the provider client id on the server before connecting.', 400);
  const request = buildTokenRequest(provider, code, txn.verifier, txn.redirectUri, client.id, client.secret);
  const response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  if (!response.ok) throw new AppError('token_exchange', 'The provider did not complete sign-in.', 502);
  const payload = /** @type {any} */ (await response.json());
  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new AppError('token_exchange', 'The provider did not complete sign-in.', 502);
  }
  const scopes = typeof payload.scope === 'string' && payload.scope.trim() ? payload.scope.split(/\s+/) : txn.scopes;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    scopes,
    obtainedAt: Date.now(),
  };
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {import('./types.js').ProviderId} provider
 * @param {import('./types.js').AppConfig} config
 * @param {typeof fetch} fetchImpl
 */
async function refreshToken(session, provider, config, fetchImpl) {
  const current = session.providers[provider];
  if (!current?.refreshToken) throw new AppError('not_connected', 'Connect this provider again.', 401);
  const client = config.clients[provider];
  const request = buildRefreshRequest(provider, current.refreshToken, client.id, client.secret, current.scopes);
  const response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  if (!response.ok) throw new AppError('not_connected', 'Connect this provider again.', 401);
  const payload = /** @type {any} */ (await response.json());
  if (!payload || typeof payload.access_token !== 'string') {
    throw new AppError('not_connected', 'Connect this provider again.', 401);
  }
  current.accessToken = payload.access_token;
  if (typeof payload.refresh_token === 'string') current.refreshToken = payload.refresh_token;
  if (typeof payload.scope === 'string' && payload.scope.trim()) current.scopes = payload.scope.split(/\s+/);
  current.obtainedAt = Date.now();
  return current;
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {import('./types.js').ProviderId} provider
 * @param {import('./types.js').AppConfig} config
 * @param {typeof fetch} fetchImpl
 */
async function listWithRefresh(session, provider, config, fetchImpl) {
  const token = session.providers[provider];
  if (!token) throw new AppError('not_connected', 'Connect this provider first.', 401);
  try {
    return await listProviderFiles(provider, token.accessToken, fetchImpl);
  } catch (error) {
    const expired = error instanceof AppError && error.code === 'list_failed' && error.details.upstream === 401;
    if (!expired || !token.refreshToken) throw error;
    const refreshed = await refreshToken(session, provider, config, fetchImpl);
    return listProviderFiles(provider, refreshed.accessToken, fetchImpl);
  }
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {import('./types.js').AppConfig} config
 * @param {typeof fetch} fetchImpl
 */
async function scanSession(session, config, fetchImpl) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  /** @type {{ provider: string, message: string }[]} */
  const errors = [];
  for (const provider of PROVIDER_IDS) {
    if (!session.providers[provider]) continue;
    try {
      if (config.mock) {
        files.push(...session.mock.files.filter((file) => file.provider === provider));
      } else {
        files.push(...await listWithRefresh(session, provider, config, fetchImpl));
      }
    } catch {
      errors.push({ provider, message: 'Could not list files.' });
    }
  }
  const groups = findDuplicates(files);
  session.scan = { groups, scannedAt: Date.now() };
  return presentScan(files.length, groups, errors, Object.keys(session.providers).length === 0);
}

/**
 * @param {number} totalFiles
 * @param {import('./types.js').DuplicateGroup[]} groups
 * @param {{ provider: string, message: string }[]} errors
 * @param {boolean} noneConnected
 */
function presentScan(totalFiles, groups, errors, noneConnected) {
  const wastedBytes = groups.reduce((sum, group) => sum + (group.wastedBytes || 0), 0);
  return {
    totalFiles,
    groups: groups.map(presentGroup),
    errors,
    summary: {
      totalFiles,
      groupCount: groups.length,
      wastedBytes,
    },
    message: noneConnected ? 'Connect a provider before scanning.' : '',
  };
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {import('./types.js').ProviderId} provider
 * @param {import('./types.js').AppConfig} config
 * @param {typeof fetch} fetchImpl
 */
async function listConnected(session, provider, config, fetchImpl) {
  if (!session.providers[provider]) throw new AppError('not_connected', 'Connect this provider first.', 401);
  if (config.mock) return session.mock.files.filter((file) => file.provider === provider);
  return listWithRefresh(session, provider, config, fetchImpl);
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {string} id
 * @param {boolean} mock
 */
function findKnownFile(session, id, mock) {
  /** @type {import('./types.js').CloudFile[]} */
  const files = [];
  if (session.scan) files.push(...session.scan.groups.flatMap((group) => group.files));
  if (session.scanParts) files.push(...Object.values(session.scanParts).flat());
  if (mock) files.push(...session.mock.files);
  return files.find((file) => file.id === id) || null;
}

/**
 * @param {import('./types.js').SessionData} session
 * @param {import('./types.js').ProviderId} provider
 * @param {string[]} required
 * @param {string} message
 */
function requireScopes(session, provider, required, message) {
  const token = session.providers[provider];
  const info = getProvider(provider);
  if (!token || !info) throw new AppError('not_connected', 'Connect this provider first.', 401);
  const missing = missingScopes(token.scopes, required);
  if (missing.length > 0) {
    throw new AppError('insufficient_scope', message, 403, { provider, requiredScopes: required });
  }
  return token;
}

/**
 * @param {unknown} body
 */
function readIds(body) {
  if (!body || typeof body !== 'object' || !('ids' in body) || !Array.isArray(body.ids)) {
    throw new AppError('nothing_selected', 'Select at least one file.', 400);
  }
  if (!body.ids.every((id) => typeof id === 'string')) {
    throw new AppError('unknown_file', 'File id was not recognized.', 400);
  }
  return /** @type {string[]} */ (body.ids);
}

export function resolvePublicDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const beside = path.join(here, 'public');
  if (existsSync(beside)) return beside;
  return path.join(here, '..', 'public');
}

/**
 * @param {{
 *   config: import('./types.js').AppConfig,
 *   fetchImpl?: typeof fetch,
 *   sessions?: ReturnType<typeof createSessionStore>,
 *   publicDir?: string,
 *   rateLimit?: boolean,
 * }} options
 */
export function createApp(options) {
  const config = options.config;
  const fetchImpl = options.fetchImpl || fetch;
  const sessions = options.sessions || createSessionStore({
    persist: config.persist,
    filePath: path.join(config.dataDir, 'sessions.enc'),
    key: config.tokenKey,
  });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const https = config.publicBase.startsWith('https://');
  app.use(helmet({
    strictTransportSecurity: https ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: https ? [] : null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const raw = readCookie(req.headers.cookie, 'sid');
    const verified = raw ? verifySessionId(raw, config.signingKey) : null;
    let sessionId = verified && sessions.get(verified) ? verified : '';
    let session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !sessionId) {
      const created = sessions.create();
      sessionId = created.id;
      session = created.data;
      setSessionCookie(res, signSessionId(sessionId, config.signingKey), config);
    }
    const current = session;
    const request = /** @type {AuthedRequest} */ (req);
    request.session = current;
    request.sessionId = sessionId;
    request.rotateSession = () => {
      const rotated = sessions.rotate(request.sessionId);
      if (!rotated) return;
      request.sessionId = rotated.id;
      request.session = rotated.data;
      setSessionCookie(res, signSessionId(rotated.id, config.signingKey), config);
    };
    res.on('finish', () => sessions.flush());
    next();
  });

  if (options.rateLimit !== false) {
    const limit = createRateLimiter({ windowMs: 60_000, max: 180 });
    app.use('/auth', limit);
    app.use('/api', limit);
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mock: config.mock });
  });

  app.get('/api/session', (req, res) => {
    const request = /** @type {AuthedRequest} */ (req);
    res.json({
      mock: config.mock,
      persistence: config.persist ? 'encrypted-file' : 'memory',
      csrf: request.session.csrf,
      photosManualSteps: PHOTOS_MANUAL_STEPS,
      reviewAlbumTitle: REVIEW_ALBUM_TITLE,
      providers: connectedProviders(request.session),
    });
  });

  app.get('/auth/:provider/start', wrap(async (req, res) => {
    const provider = getProvider(routeParam(req.params.provider));
    const purpose = routeParam(req.query.purpose || 'connect');
    if (!provider || !isPurpose(purpose)) throw new AppError('unknown_provider', 'Unknown provider.', 404);
    const scopes = scopesForPurpose(provider, purpose);
    if (!scopes) {
      throw new AppError('photos_cannot_trash', 'Google Photos has no trash permission to grant.', 409);
    }
    const redirectUri = normalizeRedirect(
      `${config.publicBase}/auth/${provider.id}/callback`,
      config.allowedRedirects,
    );
    const pkce = createPkce();
    const state = createState();
    req.session.oauth[provider.id] = {
      provider: provider.id,
      purpose,
      state,
      verifier: pkce.verifier,
      redirectUri,
      scopes,
      createdAt: Date.now(),
    };
    if (config.mock) {
      res.redirect(302, `${redirectUri}?code=mock&state=${encodeURIComponent(state)}`);
      return;
    }
    if (!config.clients[provider.id].id) {
      throw new AppError('not_configured', 'Set the provider client id on the server before connecting.', 400);
    }
    res.redirect(302, buildAuthorizeUrl(
      provider.id,
      config.clients[provider.id].id,
      redirectUri,
      state,
      pkce.challenge,
      scopes,
      purpose,
    ));
  }));

  app.get('/auth/:provider/callback', wrap(async (req, res) => {
    const provider = getProvider(routeParam(req.params.provider));
    if (!provider) throw new AppError('unknown_provider', 'Unknown provider.', 404);
    try {
      if (typeof req.query.error === 'string') {
        delete req.session.oauth[provider.id];
        res.redirect(302, `/?error=${req.query.error === 'access_denied' ? 'access_denied' : 'invalid_state'}`);
        return;
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const txn = consumeOAuthTransaction(req.session, provider.id, state);
      if (config.mock) {
        if (code !== 'mock') throw new AppError('token_exchange', 'Demo sign-in was rejected.', 400);
        req.session.providers[provider.id] = issueMockToken(provider.id, txn.scopes);
      } else {
        if (!code || code === 'mock') throw new AppError('token_exchange', 'The provider did not complete sign-in.', 400);
        req.session.providers[provider.id] = await exchangeCode(config, provider.id, txn, code, fetchImpl);
      }
      req.rotateSession();
      res.redirect(302, `/?connected=${provider.id}`);
    } catch (error) {
      const code = error instanceof AppError ? safeError(error.code) : 'token_exchange';
      res.redirect(302, `/?error=${code}`);
    }
  }));

  /** @type {import('express').RequestHandler} */
  const requireCsrf = (req, res, next) => {
    const request = /** @type {AuthedRequest} */ (req);
    const sent = request.get('x-csrf-token') || '';
    if (!safeEqual(sent, request.session.csrf)) {
      res.status(403).json({ error: 'csrf', message: 'Refresh the page and try again.' });
      return;
    }
    next();
  };

  app.post('/api/disconnect', requireCsrf, wrap(async (req, res) => {
    const provider = getProvider(typeof req.body?.provider === 'string' ? req.body.provider : '');
    if (!provider) throw new AppError('unknown_provider', 'Unknown provider.', 404);
    delete req.session.providers[provider.id];
    delete req.session.oauth[provider.id];
    req.session.scan = null;
    res.json({ ok: true, providers: connectedProviders(req.session) });
  }));

  app.post('/api/scan', requireCsrf, wrap(async (req, res) => {
    const result = await scanSession(req.session, config, fetchImpl);
    res.json(result);
  }));

  app.post('/api/scan/reset', requireCsrf, wrap(async (req, res) => {
    const connected = PROVIDER_IDS.filter((provider) => req.session.providers[provider]);
    req.session.scanParts = {};
    req.session.scan = null;
    res.json({ providers: connected, total: connected.length });
  }));

  app.post('/api/scan/step', requireCsrf, wrap(async (req, res) => {
    const provider = getProvider(typeof req.body?.provider === 'string' ? req.body.provider : '');
    if (!provider) throw new AppError('unknown_provider', 'Unknown provider.', 404);
    if (!req.session.scanParts) req.session.scanParts = {};
    const files = await listConnected(req.session, provider.id, config, fetchImpl);
    req.session.scanParts[provider.id] = files;
    const connected = PROVIDER_IDS.filter((id) => req.session.providers[id]);
    const done = connected.filter((id) => req.session.scanParts && req.session.scanParts[id]).length;
    res.json({
      provider: provider.id,
      fileCount: files.length,
      done,
      total: connected.length,
    });
  }));

  app.post('/api/scan/finish', requireCsrf, wrap(async (req, res) => {
    /** @type {import('./types.js').CloudFile[]} */
    const files = req.session.scanParts ? Object.values(req.session.scanParts).flat() : [];
    const groups = findDuplicates(files);
    req.session.scan = { groups, scannedAt: Date.now() };
    res.json(presentScan(files.length, groups, [], Object.keys(req.session.providers).length === 0));
  }));

  app.get('/api/preview', wrap(async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const file = findKnownFile(req.session, id, config.mock);
    if (!file || file.kind !== 'image') {
      res.status(404).end();
      return;
    }
    if (config.mock) {
      const key = safeSampleKey(file.sampleKey);
      const samplePath = key ? path.join(resolvePublicDir(), 'samples', `${key}.png`) : '';
      if (!key || !existsSync(samplePath)) {
        res.status(404).end();
        return;
      }
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'private, max-age=300');
      res.set('X-Content-Type-Options', 'nosniff');
      res.end(readFileSync(samplePath));
      return;
    }
    const token = req.session.providers[file.provider];
    if (!token) {
      res.status(404).end();
      return;
    }
    const request = buildThumbnailRequest(file, token.accessToken);
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (!response.ok) {
      res.status(404).end();
      return;
    }
    const type = response.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', type.split(';')[0]);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(await response.arrayBuffer()));
  }));

  app.post('/api/trash', requireCsrf, wrap(async (req, res) => {
    if (!req.body || req.body.confirmation !== TRASH_CONFIRMATION) {
      throw new AppError(
        'confirmation_required',
        'Confirm that these files should be moved to trash. Nothing is permanently deleted.',
        400,
      );
    }
    if (!req.session.scan) throw new AppError('scan_required', 'Scan again before moving files to trash.', 400);
    const planned = planTrash(req.session.scan.groups, readIds(req.body));
    for (const file of planned) {
      const info = getProvider(file.provider);
      if (!info) throw new AppError('unknown_provider', 'Unknown provider.', 404);
      requireScopes(
        req.session,
        file.provider,
        info.trashScopes,
        `${info.name} needs permission to move files to trash. Grant it, then confirm again.`,
      );
    }
    /** @type {{ id: string, ok: boolean, provider: string, action: string, error?: string }[]} */
    const results = [];
    for (const file of planned) {
      try {
        if (config.mock) {
          mockTrash(req.session.mock, file);
        } else {
          const token = req.session.providers[file.provider];
          if (!token) throw new AppError('not_connected', 'Connect this provider first.', 401);
          await executeTrash(file, token.accessToken, fetchImpl);
        }
        results.push({ id: file.id, ok: true, provider: file.provider, action: 'trash' });
      } catch (error) {
        const message = error instanceof AppError ? error.message : 'The provider did not move the file to trash.';
        results.push({ id: file.id, ok: false, provider: file.provider, action: 'trash', error: message });
      }
    }
    const scanned = await scanSession(req.session, config, fetchImpl);
    res.json({
      ok: results.every((result) => result.ok),
      results,
      groups: scanned.groups,
      totalFiles: scanned.totalFiles,
    });
  }));

  app.post('/api/photos/album', requireCsrf, wrap(async (req, res) => {
    if (!req.body || req.body.confirmation !== ALBUM_CONFIRMATION) {
      throw new AppError('confirmation_required', 'Confirm before adding photos to the review album.', 400);
    }
    if (!req.session.scan) throw new AppError('scan_required', 'Scan again before organizing photos.', 400);
    const ids = new Set(readIds(req.body));
    const known = req.session.scan.groups.flatMap((group) => group.files);
    const selected = known.filter((file) => ids.has(file.id));
    if (selected.length !== ids.size) {
      throw new AppError('unknown_file', 'That photo is not in the latest scan. Scan again.', 400);
    }
    if (selected.some((file) => file.provider !== 'gphotos')) {
      throw new AppError('no_photos', 'Only Google Photos items can be added to the review album.', 400);
    }
    const photosToken = requireScopes(
      req.session,
      'gphotos',
      getProvider('gphotos')?.albumScopes || [],
      'Google Photos needs permission to add items to an album. This does not delete them.',
    );
    if (config.mock) {
      const album = mockAddToAlbum(req.session.mock, selected);
      res.json({
        ok: true,
        albumCreated: true,
        albumAdded: true,
        albumTitle: album.title,
        added: selected.map((file) => ({ id: file.id, name: file.name })),
        manualSteps: PHOTOS_MANUAL_STEPS,
        note: 'The album does not delete anything. Trash the extra copies in Google Photos.',
      });
      return;
    }
    const localIds = selected.map((file) => splitCompositeId(file.id).localId);
    const created = await createReviewAlbum(localIds, photosToken.accessToken, fetchImpl);
    res.json({
      ok: created.albumCreated && created.added,
      albumCreated: created.albumCreated,
      albumAdded: created.added,
      albumTitle: REVIEW_ALBUM_TITLE,
      added: selected.map((file) => ({ id: file.id, name: file.name })),
      manualSteps: PHOTOS_MANUAL_STEPS,
      note: created.albumCreated
        ? 'The album does not delete anything. Trash the extra copies in Google Photos.'
        : 'Google Photos did not accept the album. Follow the manual steps. Nothing was deleted.',
    });
  }));

  app.get('/favicon.ico', (req, res) => {
    void req;
    res.status(204).end();
  });

  app.use('/api', (req, res) => {
    void req;
    res.status(404).json({ error: 'not_found', message: 'Unknown API route.' });
  });

  app.use(express.static(options.publicDir || resolvePublicDir(), { index: 'index.html', fallthrough: false }));

  app.use((
    /** @type {unknown} */ error,
    /** @type {import('express').Request} */ req,
    /** @type {import('express').Response} */ res,
    /** @type {import('express').NextFunction} */ next,
  ) => {
    void req;
    void next;
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: error.code,
        message: error.message,
        ...error.details,
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'bad_json', message: 'Request body was not valid JSON.' });
      return;
    }
    if (typeof error === 'object' && error && 'status' in error && error.status === 404) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
  });

  return app;
}
