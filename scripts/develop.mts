import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {watchTypescript} from './build-typescript.mts';

const closeWatcher = watchTypescript();
const webExt = fileURLToPath(new URL('../node_modules/web-ext/bin/web-ext.js', import.meta.url));
const child = spawn(process.execPath, [webExt, 'run', '--source-dir', 'extension'], {stdio: 'inherit'});
const interrupt = () => {closeWatcher(); child.kill('SIGINT');};
const terminate = () => {closeWatcher(); child.kill('SIGTERM');};
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);
child.once('error', (error) => {closeWatcher(); console.error(error.message); process.exitCode = 1;});
child.once('exit', (code, signal) => {
  closeWatcher();
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
