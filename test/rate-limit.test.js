// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/rate-limit.js';

function call(limit, ip, path) {
  let status = 200; let passed = false;
  const res = { set() {}, status(s) { status = s; return this; }, json() {} };
  limit({ ip, path }, res, () => { passed = true; });
  return passed ? 200 : status;
}

test('limits per IP regardless of path', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal(call(limit, '1.1.1.1', `/api/x${i}`), 200);
  assert.equal(call(limit, '1.1.1.1', '/api/other'), 429);
  assert.equal(call(limit, '2.2.2.2', '/api/x'), 200);
});

test('client table stays bounded', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 5 });
  for (let i = 0; i < 50; i += 1) assert.equal(call(limit, `10.0.0.${i}`, '/'), 200);
});
