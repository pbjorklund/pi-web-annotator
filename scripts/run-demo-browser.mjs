import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webExt = resolve(root, 'node_modules/web-ext/bin/web-ext.js');

async function firstAvailable(paths) {
  for (const path of paths) {
    if (!path) continue;
    try {
      await access(path);
      return path;
    } catch {}
  }
  return undefined;
}

const firefox = process.env.FIREFOX_BIN ?? await firstAvailable([
  '/usr/bin/firefox',
  '/usr/bin/zen-browser',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
]);
const args = [
  webExt,
  'run',
  '--source-dir',
  resolve(root, 'extension'),
  '--start-url',
  process.env.PI_WEB_ANNOTATOR_DEMO_URL ?? 'http://127.0.0.1:4173',
];
if (firefox) args.push('--firefox', firefox);

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.once('error', (error) => {
  console.error(`Could not start the demo browser: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
