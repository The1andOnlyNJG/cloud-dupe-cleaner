// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPkce, createState, missingScopes, normalizeRedirect, safeEqual } from '../src/oauth.js';
import { buildAuthorizeUrl, buildTokenRequest } from '../src/provider-api.js';
import { getProvider, scopesForPurpose } from '../src/catalog.js';
import { AppError } from '../src/errors.js';

const allow = ['http://127.0.0.1:3000/auth/dropbox/callback'];

test('PKCE uses S256 and a high-entropy verifier', () => {
  const pkce = createPkce();
  assert.equal(pkce.method, 'S256');
  assert.ok(pkce.verifier.length >= 43 && pkce.verifier.length <= 128);
  assert.notEqual(pkce.challenge, pkce.verifier);
  assert.equal(createPkce().verifier === pkce.verifier, false);
});

test('state is unguessable and compared in constant time', () => {
  const state = createState();
  assert.ok(state.length >= 43);
  assert.equal(safeEqual(state, state), true);
  assert.equal(safeEqual(state, `${state}x`), false);
  assert.equal(safeEqual(state, 'nope'), false);
});

test('redirect allowlist rejects open redirects and normalization tricks', () => {
  assert.equal(normalizeRedirect(allow[0], allow), allow[0]);
  const rejected = [
    'https://evil.example/auth/dropbox/callback',
    'http://127.0.0.1:3000.evil.example/auth/dropbox/callback',
    'http://evil.example@127.0.0.1:3000/auth/dropbox/callback',
    'http://127.0.0.1:3000/auth/dropbox/callback?next=https://evil.example',
    'http://127.0.0.1:3000/auth/dropbox/callback#fragment',
    'http://127.0.0.1:3000/auth/dropbox/callback/../callback',
    'http://127.0.0.1:3000/auth/dropbox/callback/',
    '//evil.example',
    'javascript:alert(1)',
    'http://127.0.0.1:3000\\@evil.example',
  ];
  for (const uri of rejected) {
    assert.throws(() => normalizeRedirect(uri, allow), (error) => error instanceof AppError && error.code === 'redirect_rejected');
  }
});

test('authorize URLs are authorization-code plus PKCE and omit the client secret', () => {
  const cases = [
    ['dropbox', 'connect', 'https://www.dropbox.com/oauth2/authorize', ['files.metadata.read']],
    ['onedrive', 'connect', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', ['Files.Read', 'offline_access']],
    ['gdrive', 'connect', 'https://accounts.google.com/o/oauth2/v2/auth', ['https://www.googleapis.com/auth/drive.readonly']],
    ['gphotos', 'connect', 'https://accounts.google.com/o/oauth2/v2/auth', ['https://www.googleapis.com/auth/photoslibrary.readonly']],
  ];
  for (const row of cases) {
    const provider = /** @type {import('../src/types.js').ProviderId} */ (row[0]);
    const origin = /** @type {string} */ (row[2]);
    const scopes = /** @type {string[]} */ (row[3]);
    const info = getProvider(provider);
    assert.ok(info);
    const wanted = scopesForPurpose(info, 'connect');
    assert.deepEqual(wanted, scopes);
    const url = new URL(buildAuthorizeUrl(info.id, 'client-id', allow[0], 'state-value', 'challenge-value', wanted || [], 'connect'));
    assert.equal(url.origin + url.pathname, origin);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(url.searchParams.get('redirect_uri'), allow[0]);
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.equal(url.searchParams.get('response_type') === 'token', false);
  }
});

test('trash and album scopes are requested only for that purpose', () => {
  const drive = getProvider('gdrive');
  const photos = getProvider('gphotos');
  const dropbox = getProvider('dropbox');
  assert.ok(drive && photos && dropbox);
  assert.equal(scopesForPurpose(photos, 'trash'), null);
  assert.deepEqual(scopesForPurpose(drive, 'trash'), [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive',
  ]);
  assert.ok(scopesForPurpose(dropbox, 'connect')?.includes('files.metadata.read'));
  assert.equal(scopesForPurpose(dropbox, 'connect')?.includes('files.content.write'), false);
  assert.ok(scopesForPurpose(dropbox, 'trash')?.includes('files.content.write'));
  assert.equal(scopesForPurpose(dropbox, 'trash')?.includes('files.content.read'), false);
  assert.deepEqual(missingScopes(['Files.Read', 'offline_access'], ['Files.ReadWrite']), ['Files.ReadWrite']);
});

test('token exchange sends the verifier and keeps the secret out of the URL', () => {
  const request = buildTokenRequest('gdrive', 'code-1', 'verifier-1', allow[0], 'client-id', '');
  assert.equal(request.url, 'https://oauth2.googleapis.com/token');
  assert.equal(request.url.includes('client_secret'), false);
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('code_verifier'), 'verifier-1');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.has('client_secret'), false);
  const confidential = new URLSearchParams(buildTokenRequest('dropbox', 'c', 'v', allow[0], 'id', 'secret').body);
  assert.equal(confidential.get('client_secret'), 'secret');
});
