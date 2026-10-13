// @ts-check
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile(path.join(process.cwd(), '.env'));
const config = loadConfig(process.env);
const app = createApp({ config });

app.listen(config.port, config.host, () => {
  const mode = config.mock ? 'demo data, no cloud calls' : 'live OAuth';
  const persistence = config.persist ? 'encrypted file' : 'memory only';
  console.log(`Cloud Dupe Cleaner on http://${config.host}:${config.port} (${mode}, tokens ${persistence})`);
  if (config.signingKeyEphemeral) {
    console.log('SESSION_SIGNING_KEY is not set. Sessions end when the process stops.');
  }
});
