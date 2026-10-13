// @ts-check
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRateLimiter } from '../src/rate-limit.js';

/** @param {string} dir @param {string[]} acc */
function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('first-party code does not keep the old insecure patterns', () => {
  const files = [...walk('src', []), ...walk('public', [])];
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /files\/permanently_delete/);
  assert.doesNotMatch(source, /\/permanentDelete/);
  assert.doesNotMatch(source, /mediaItems:batchDelete/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /document\.write/);
  assert.doesNotMatch(source, /dev-secret-change-me/);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /eval\(/);
  assert.match(readFileSync('src/provider-api.js', 'utf8'), /trashed:\s*true/);
});

test('rate limiter blocks the extra request', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 2 });
  /** @type {number[]} */
  const statuses = [];
  const req = /** @type {import('express').Request} */ ({ ip: '127.0.0.1', path: '/auth/x' });
  for (let i = 0; i < 3; i += 1) {
    const res = {
      /** @param {number} code @param {unknown} _body */
      status(code, _body) {
        statuses.push(code);
        return this;
      },
      /** @param {unknown} _body */
      json(_body) { return this; },
    };
    let called = false;
    limit(req, /** @type {import('express').Response} */ (res), () => { called = true; });
    if (called) statuses.push(200);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('android manifest and storage keep tokens off backups and unexported surfaces', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.equal([...manifest.matchAll(/android:exported="true"/g)].length, 2);
  assert.match(manifest, /android:scheme="clouddupecleaner"/);
  assert.match(manifest, /\$\{googleRedirectScheme\}/);
  assert.match(manifest, /android:path="\/oauth2redirect"/);
  assert.doesNotMatch(manifest, /<provider|<service|<receiver/);
  assert.doesNotMatch(manifest, /android:debuggable="true"/);

  const backup = readFileSync('android/app/src/main/res/xml/backup_rules.xml', 'utf8');
  const extraction = readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
  const network = readFileSync('android/app/src/main/res/xml/network_security_config.xml', 'utf8');
  assert.match(backup, /domain="sharedpref"/);
  assert.match(extraction, /<cloud-backup>[\s\S]*domain="sharedpref"/);
  assert.match(extraction, /<device-transfer>[\s\S]*domain="sharedpref"/);
  assert.match(network, /cleartextTrafficPermitted="false"/);

  const store = readFileSync('android/app/src/main/java/com/njg/clouddupecleaner/SecureTokenStore.kt', 'utf8');
  assert.match(store, /EncryptedSharedPreferences/);
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /MasterKey/);
  assert.doesNotMatch(store, /MODE_WORLD_READABLE|commit\(\)|Log\./);
  const kotlin = readFileSync('android/app/src/main/java/com/njg/clouddupecleaner/MainActivity.kt', 'utf8')
    + readFileSync('android/core/src/main/kotlin/com/njg/clouddupecleaner/TrashPolicy.kt', 'utf8');
  assert.match(kotlin, /MOVE_TO_TRASH/);
  assert.match(kotlin, /photos_cannot_trash|Photos cannot/);
});
