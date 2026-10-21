import {watchTypescript} from './build-typescript.mts';
import { spawn, type SpawnOptions } from 'node:child_process';
import { object } from '../pi-extension/contracts.ts';
type DevCommand = {executable: string; args: string[]; options: SpawnOptions};
type DevChild = {pid?: number; once(event: 'error', listener: (error: Error) => void): unknown; once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown};
type SignalSource = {once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown; off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown};
type DevOptions = {signalSource?: SignalSource; spawnProcess?: (command: string, args: string[], options: SpawnOptions) => DevChild; terminateGroup?: (pid: number, signal: NodeJS.Signals) => unknown; command?: DevCommand};
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultWebExtBin = path.resolve(directory, '../node_modules/web-ext/bin/web-ext.js');
const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143 };

export function createZenDevCommand({
  profileDir = process.env.ZEN_PROFILE
    ?? path.join(os.homedir(), '.zen', '2el4bbvx.Default (release)'),
  webExtBin = defaultWebExtBin,
}: {profileDir?: string; webExtBin?: string} = {}): DevCommand {
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

export function terminateProcessGroup(pid: number, signal: NodeJS.Signals, kill: (pid: number, signal: NodeJS.Signals) => unknown = process.kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (object(error) && error.code === 'ESRCH') return false;
    throw error;
  }
}

export function runZenDev({
  signalSource = process,
  spawnProcess = spawn,
  terminateGroup = terminateProcessGroup,
  command = createZenDevCommand(),
}: DevOptions = {}): Promise<number> {
  const child = spawnProcess(command.executable, command.args, command.options);

  return new Promise<number>((resolve, reject) => {
    let requestedSignal: 'SIGINT' | 'SIGTERM' | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      signalSource.off('SIGINT', onInterrupt);
      signalSource.off('SIGTERM', onTerminate);
      if (forceTimer) clearTimeout(forceTimer);
    };
    const finish = (error: Error | undefined, exitCode = 1) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(exitCode);
    };
    const requestShutdown = (signal: 'SIGINT' | 'SIGTERM') => {
      if (requestedSignal) return;
      requestedSignal = signal;
      if (child.pid !== undefined) terminateGroup(child.pid, 'SIGTERM');
      forceTimer = setTimeout(() => {
        if (child.pid !== undefined) terminateGroup(child.pid, 'SIGKILL');
      }, 2000);
      forceTimer.unref?.();
    };
    const onInterrupt = () => requestShutdown('SIGINT');
    const onTerminate = () => requestShutdown('SIGTERM');

    signalSource.once('SIGINT', onInterrupt);
    signalSource.once('SIGTERM', onTerminate);
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      const exitCode = requestedSignal
        ? signalExitCodes[requestedSignal]
        : code ?? (signal ? signalExitCodes[signal] : undefined) ?? 1;
      finish(undefined, exitCode);
    });
  });
}

async function main() {
  console.log('Zen reloads the extension when source files change. Press Ctrl-C to stop Zen and web-ext.');
  const closeWatcher = watchTypescript();
  try { process.exitCode = await runZenDev(); } finally { closeWatcher(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
