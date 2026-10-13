// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectProvider, withServer } from './helpers.js';

test('demo flow connects, scans, requires confirmation, and only trashes after a trash grant', async () => {
  await withServer({}, async ({ api }) => {
    const health = await api('/api/health');
    assert.equal(health.data.status, 'ok');
    assert.equal(health.data.mock, true);
    const setCookie = health.response.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /Secure/i);

    const session = await api('/api/session');
    assert.equal(session.data.persistence, 'memory');
    assert.equal(typeof session.data.csrf, 'string');
    const cookieBeforeConnect = session.cookie;
    await connectProvider(api, 'dropbox');
    const after = await api('/api/session');
    assert.notEqual(after.cookie, cookieBeforeConnect);
    const dropbox = after.data.providers.find((/** @type {{ id: string }} */ item) => item.id === 'dropbox');
    assert.equal(dropbox.connected, true);
    assert.deepEqual(dropbox.grantedScopes, ['files.metadata.read', 'files.content.read']);
    assert.equal(JSON.stringify(after.data).includes('mock-access'), false);

    const scan = await api('/api/scan', { method: 'POST', csrf: after.data.csrf, body: {} });
    const holiday = scan.data.groups.find((/** @type {{ hashAlgo: string }} */ group) => group.hashAlgo === 'dropbox-content-hash');
    assert.ok(holiday);
    assert.equal(holiday.match, 'content');
    const extra = holiday.files[1].id;
    const preview = await api(`/api/preview?id=${encodeURIComponent(holiday.files[0].id)}`);
    assert.equal(preview.response.status, 200);
    assert.match(preview.response.headers.get('content-type') || '', /image\/png/);
    const bytes = new Uint8Array(await preview.response.arrayBuffer());
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50);

    const noCsrf = await api('/api/trash', { method: 'POST', body: { ids: [extra], confirmation: 'MOVE_TO_TRASH' } });
    assert.equal(noCsrf.response.status, 403);

    const noConfirm = await api('/api/trash', {
      method: 'POST',
      csrf: after.data.csrf,
      body: { ids: [extra], confirmation: 'yes' },
    });
    assert.equal(noConfirm.response.status, 400);
    assert.equal(noConfirm.data.error, 'confirmation_required');

    const needsScope = await api('/api/trash', {
      method: 'POST',
      csrf: after.data.csrf,
      body: { ids: [extra], confirmation: 'MOVE_TO_TRASH' },
    });
    assert.equal(needsScope.response.status, 403);
    assert.equal(needsScope.data.error, 'insufficient_scope');
    assert.deepEqual(needsScope.data.requiredScopes, ['files.content.write']);

    await connectProvider(api, 'dropbox', 'trash');
    const granted = await api('/api/session');
    const trashed = await api('/api/trash', {
      method: 'POST',
      csrf: granted.data.csrf,
      body: { ids: [extra], confirmation: 'MOVE_TO_TRASH' },
    });
    assert.equal(trashed.response.status, 200);
    assert.equal(trashed.data.ok, true);
    assert.equal(trashed.data.results[0].action, 'trash');
    assert.equal(JSON.stringify(trashed.data).includes('mock-access'), false);
    const still = trashed.data.groups.find((/** @type {{ hashAlgo: string }} */ group) => group.hashAlgo === 'dropbox-content-hash');
    assert.equal(still, undefined);

    const keeperAttempt = await api('/api/scan', { method: 'POST', csrf: granted.data.csrf, body: {} });
    const notes = keeperAttempt.data.groups.find((/** @type {{ match: string, files: { provider: string }[] }} */ group) => {
      return group.match === 'weak' && group.files.every((file) => file.provider === 'onedrive');
    });
    assert.equal(notes, undefined);
  });
});

test('google photos are flagged, album-only, and never trashed', async () => {
  await withServer({}, async ({ api }) => {
    const session = await api('/api/session');
    await connectProvider(api, 'gphotos');
    const connected = await api('/api/session');
    const scan = await api('/api/scan', { method: 'POST', csrf: connected.data.csrf, body: {} });
    const photos = scan.data.groups.find((/** @type {{ files: { provider: string }[] }} */ group) => group.files[0].provider === 'gphotos');
    assert.ok(photos);
    assert.equal(photos.match, 'weak');
    assert.equal(photos.files.every((/** @type {{ trashable: boolean }} */ file) => file.trashable === false), true);

    const blocked = await api('/api/trash', {
      method: 'POST',
      csrf: connected.data.csrf,
      body: { ids: [photos.files[1].id], confirmation: 'MOVE_TO_TRASH' },
    });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.data.error, 'photos_cannot_trash');

    const ungranted = await api('/api/photos/album', {
      method: 'POST',
      csrf: connected.data.csrf,
      body: { ids: photos.files.map((/** @type {{ id: string }} */ file) => file.id), confirmation: 'ADD_TO_REVIEW_ALBUM' },
    });
    assert.equal(ungranted.response.status, 403);

    await connectProvider(api, 'gphotos', 'album');
    const ready = await api('/api/session');
    const album = await api('/api/photos/album', {
      method: 'POST',
      csrf: ready.data.csrf,
      body: { ids: photos.files.map((/** @type {{ id: string }} */ file) => file.id), confirmation: 'ADD_TO_REVIEW_ALBUM' },
    });
    assert.equal(album.data.albumCreated, true);
    assert.equal(album.data.albumTitle, 'Duplicate review');
    assert.ok(album.data.manualSteps.length >= 3);
    const again = await api('/api/scan', { method: 'POST', csrf: ready.data.csrf, body: {} });
    const stillThere = again.data.groups.find((/** @type {{ files: { provider: string }[] }} */ group) => group.files[0].provider === 'gphotos');
    assert.ok(stillThere);
    assert.equal(session.data.mock, true);
  });
});

test('oauth state is single use and a mismatch is rejected', async () => {
  await withServer({}, async ({ api }) => {
    const start = await api('/auth/onedrive/start?purpose=connect');
    const location = new URL(start.response.headers.get('location') || '', 'http://127.0.0.1');
    const state = location.searchParams.get('state') || '';
    const bad = await api(`/auth/onedrive/callback?code=mock&state=${state}no`);
    assert.equal(new URL(bad.response.headers.get('location') || '', 'http://127.0.0.1').searchParams.get('error'), 'invalid_state');
    const replay = await api(`${location.pathname}${location.search}`);
    assert.equal(new URL(replay.response.headers.get('location') || '', 'http://127.0.0.1').searchParams.get('error'), 'invalid_state');
  });
});

test('live dropbox uses PKCE, refuses permanent delete, and hides the access token', async () => {
  /** @type {{ url: string, method: string, body: string }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    const body = typeof options.body === 'string' ? options.body : '';
    calls.push({ url: href, method, body });
    if (href.includes('/oauth2/token')) {
      const params = new URLSearchParams(body);
      const scope = params.get('code') === 'upgrade'
        ? 'files.metadata.read files.content.write'
        : 'files.metadata.read';
      return Response.json({ access_token: 'live-token-secret', scope });
    }
    if (href.endsWith('/files/list_folder')) {
      return Response.json({
        entries: [
          { '.tag': 'file', id: 'id:1', name: 'a.txt', path_display: '/a.txt', size: 5, content_hash: 'hash-1' },
          { '.tag': 'file', id: 'id:2', name: 'a-copy.txt', path_display: '/a-copy.txt', size: 5, content_hash: 'hash-1' },
        ],
        has_more: false,
      });
    }
    if (href.endsWith('/files/delete_v2')) {
      return Response.json({ metadata: { name: 'a-copy.txt' } });
    }
    return Response.json({ error: 'unexpected' }, { status: 404 });
  };

  await withServer({
    env: { MOCK_PROVIDERS: 'false', DROPBOX_CLIENT_ID: 'dbx-client' },
    fetchImpl,
  }, async ({ api }) => {
    const start = await api('/auth/dropbox/start?purpose=connect');
    const authorize = new URL(start.response.headers.get('location') || '');
    assert.equal(authorize.origin, 'https://www.dropbox.com');
    assert.equal(authorize.searchParams.get('response_type'), 'code');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.has('client_secret'), false);
    const state = authorize.searchParams.get('state') || '';
    const callback = await api(`/auth/dropbox/callback?code=read&state=${encodeURIComponent(state)}`);
    assert.match(callback.response.headers.get('location') || '', /connected=dropbox/);
    const tokenCall = calls.find((call) => call.url.includes('/oauth2/token'));
    if (!tokenCall) throw new Error('missing token request');
    const tokenBody = new URLSearchParams(tokenCall.body);
    const verifier = tokenBody.get('code_verifier') || '';
    assert.ok(verifier.length > 0);
    assert.equal(tokenBody.has('client_secret'), false);

    const session = await api('/api/session');
    const scan = await api('/api/scan', { method: 'POST', csrf: session.data.csrf, body: {} });
    assert.equal(JSON.stringify(scan.data).includes('live-token-secret'), false);
    const group = scan.data.groups[0];
    const denied = await api('/api/trash', {
      method: 'POST',
      csrf: session.data.csrf,
      body: { ids: [group.files[1].id], confirmation: 'MOVE_TO_TRASH' },
    });
    assert.equal(denied.data.error, 'insufficient_scope');

    const upgrade = await api('/auth/dropbox/start?purpose=trash');
    const upgradeUrl = new URL(upgrade.response.headers.get('location') || '');
    await api(`/auth/dropbox/callback?code=upgrade&state=${encodeURIComponent(upgradeUrl.searchParams.get('state') || '')}`);
    const ready = await api('/api/session');
    const trashed = await api('/api/trash', {
      method: 'POST',
      csrf: ready.data.csrf,
      body: { ids: [group.files[1].id], confirmation: 'MOVE_TO_TRASH' },
    });
    assert.equal(trashed.data.ok, true);
    const deletion = calls.find((call) => call.url.includes('delete'));
    assert.ok(deletion);
    assert.equal(deletion.url, 'https://api.dropboxapi.com/2/files/delete_v2');
    assert.equal(deletion.method, 'POST');
    assert.equal(calls.some((call) => call.url.includes('permanently_delete')), false);
    assert.equal(JSON.stringify(trashed.data).includes('live-token-secret'), false);
  });
});
