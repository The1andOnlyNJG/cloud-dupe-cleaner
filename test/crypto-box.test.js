// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ciphertextContains, decryptJson, encryptJson } from '../src/crypto-box.js';
import { createSessionStore } from '../src/sessions.js';

test('AES-GCM ciphertext does not contain the token and rejects the wrong key', () => {
  const key = Buffer.alloc(32, 4);
  const token = 'mock-access.super-secret-token';
  assert.equal(ciphertextContains(token, key), false);
  const payload = encryptJson({ accessToken: token, nested: { refresh: 'refresh-secret' } }, key);
  assert.equal(payload.includes(token), false);
  assert.equal(payload.includes('refresh-secret'), false);
  assert.equal(decryptJson(payload, key).accessToken, token);
  assert.throws(() => decryptJson(payload, Buffer.alloc(32, 5)));
  assert.throws(() => encryptJson({ ok: true }, Buffer.alloc(16, 1)));
});

test('persisted sessions are encrypted, mode 0600, and round-trip', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cdc-vault-'));
  const filePath = path.join(dir, 'sessions.enc');
  const key = Buffer.alloc(32, 9);
  try {
    const store = createSessionStore({ persist: true, filePath, key });
    const created = store.create();
    created.data.providers.dropbox = {
      accessToken: 'mock-access.disk-token',
      refreshToken: 'refresh-disk',
      scopes: ['files.metadata.read'],
      obtainedAt: 1,
    };
    store.flush();
    const raw = readFileSync(filePath, 'utf8');
    assert.equal(raw.includes('mock-access.disk-token'), false);
    assert.equal(raw.includes('refresh-disk'), false);
    assert.equal(raw.includes(created.data.csrf), false);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    const restored = createSessionStore({ persist: true, filePath, key });
    const loaded = restored.get(created.id);
    assert.equal(loaded?.providers.dropbox?.accessToken, 'mock-access.disk-token');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
