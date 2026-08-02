import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createZenDevCommand,
  runZenDev,
  terminateProcessGroup,
} from '../scripts/run-zen-dev.mjs';

class FakeChild extends EventEmitter {
  constructor(pid = 4242) {
    super();
    this.pid = pid;
  }
}

test('runs web-ext without terminal input in an isolated process group', () => {
  const command = createZenDevCommand({
    profileDir: '/tmp/Zen Profile',
    webExtBin: '/repo/node_modules/web-ext/bin/web-ext.js',
  });

  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args, [
    '/repo/node_modules/web-ext/bin/web-ext.js',
    'run',
    '--source-dir', 'extension',
    '--firefox', '/usr/bin/zen-browser',
    '--firefox-profile', '/tmp/Zen Profile',
    '--keep-profile-changes',
    '--no-input',
  ]);
  assert.deepEqual(command.options, {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
});

test('stops the whole web-ext and Zen process group on Ctrl-C', async () => {
  const child = new FakeChild();
  const signalSource = new EventEmitter();
  const terminations = [];
  const run = runZenDev({
    signalSource,
    spawnProcess: () => child,
    terminateGroup: (pid, signal) => terminations.push({ pid, signal }),
  });

  signalSource.emit('SIGINT');
  assert.deepEqual(terminations, [{ pid: child.pid, signal: 'SIGTERM' }]);
  child.emit('exit', null, 'SIGTERM');

  assert.equal(await run, 130);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

test('ignores an already-gone process group during shutdown', () => {
  assert.equal(terminateProcessGroup(4242, 'SIGTERM', () => {
    const error = new Error('missing');
    error.code = 'ESRCH';
    throw error;
  }), false);
});
