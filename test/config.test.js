// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('development defaults to demo mode, localhost, and memory-only tokens', () => {
  const config = loadConfig({});
  assert.equal(config.mock, true);
  assert.equal(config.persist, false);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.signingKeyEphemeral, true);
  assert.equal(config.tokenKey, null);
  assert.equal(config.allowedRedirects.length, 4);
});

test('production refuses implicit demo mode and plaintext token persistence', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /MOCK_PROVIDERS/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    MOCK_PROVIDERS: 'true',
  }), /PERSIST_TOKENS/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    MOCK_PROVIDERS: 'false',
    PERSIST_TOKENS: 'false',
  }), /SESSION_SIGNING_KEY/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    MOCK_PROVIDERS: 'true',
    PERSIST_TOKENS: 'true',
    SESSION_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64'),
  }), /TOKEN_ENCRYPTION_KEY/);
  const config = loadConfig({
    NODE_ENV: 'production',
    MOCK_PROVIDERS: 'true',
    PERSIST_TOKENS: 'false',
    SESSION_SIGNING_KEY: Buffer.alloc(32, 1).toString('base64'),
    HOST: '127.0.0.1',
  });
  assert.equal(config.production, true);
  assert.equal(config.persist, false);
});
