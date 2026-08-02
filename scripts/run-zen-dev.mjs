import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultWebExtBin = path.resolve(directory, '../node_modules/web-ext/bin/web-ext.js');
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };

export function createZenDevCommand({
  profileDir = process.env.ZEN_PROFILE
    ?? path.join(os.homedir(), '.zen', '2el4bbvx.Default (release)'),
  webExtBin = defaultWebExtBin,
} = {}) {
  return {
    executable: process.execPath,
    args: [
      webExtBin,
      'run',
      '--source-dir', 'extension',
      '--firefox', '/usr/bin/zen-browser',
      '--firefox-profile', profileDir,
      '--keep-profile-changes',
      '--no-input',
    ],
    options: {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  };
}

export function terminateProcessGroup(pid, signal, kill = process.kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

export function runZenDev({
  signalSource = process,
  spawnProcess = spawn,
  terminateGroup = terminateProcessGroup,
  command = createZenDevCommand(),
} = {}) {
  const child = spawnProcess(command.executable, command.args, command.options);

  return new Promise((resolve, reject) => {
    let requestedSignal;
    let forceTimer;
    let settled = false;

    const cleanup = () => {
      signalSource.off('SIGINT', onInterrupt);
      signalSource.off('SIGTERM', onTerminate);
      if (forceTimer) clearTimeout(forceTimer);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const requestShutdown = (signal) => {
      if (requestedSignal) return;
      requestedSignal = signal;
      terminateGroup(child.pid, 'SIGTERM');
      forceTimer = setTimeout(() => {
        terminateGroup(child.pid, 'SIGKILL');
      }, 2000);
      forceTimer.unref?.();
    };
    const onInterrupt = () => requestShutdown('SIGINT');
    const onTerminate = () => requestShutdown('SIGTERM');

    signalSource.once('SIGINT', onInterrupt);
    signalSource.once('SIGTERM', onTerminate);
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      const exitCode = requestedSignal
        ? signalExitCodes[requestedSignal]
        : code ?? signalExitCodes[signal] ?? 1;
      finish(resolve, exitCode);
    });
  });
}

async function main() {
  console.log('Zen reloads the extension when source files change. Press Ctrl-C to stop Zen and web-ext.');
  process.exitCode = await runZenDev();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
