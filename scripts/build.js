// @ts-check
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'server.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(dist, 'server.js'),
  packages: 'external',
  logLevel: 'warning',
});
await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
console.log('Built dist/server.js and dist/public');
