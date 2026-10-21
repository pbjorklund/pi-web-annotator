import {requireCleanSource} from '../scripts/source-archive.mts';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {buildTypescript, watchTypescript} from '../scripts/build-typescript.mts';
import {required} from '../pi-extension/contracts.ts';

test('deterministic emission detects drift, rewrites imports, and rebuilds watched TypeScript', {timeout: 10_000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'annotator-typescript-'));
  let close: (() => void) | undefined;
  t.after(async () => {close?.(); await rm(root, {recursive: true, force: true});});
  for (const folder of ['src/browser', 'extension', 'pi-extension', 'scripts']) await mkdir(join(root, folder), {recursive: true});
  await writeFile(join(root, 'src/browser/example.ts'), 'const label: string = "before";');
  await writeFile(join(root, 'pi-extension/server.ts'), 'export const status: string = "ready";');
  await writeFile(join(root, 'pi-extension/contracts.ts'), 'export {};');
  await writeFile(join(root, 'scripts/example.mts'), 'import {status} from "../pi-extension/server.ts"; console.log(status);');
  assert.equal(buildTypescript(root), true);
  const original = await readFile(join(root, 'extension/example.js'), 'utf8');
  assert.equal(buildTypescript(root, true), true);
  buildTypescript(root);
  assert.equal(await readFile(join(root, 'extension/example.js'), 'utf8'), original);
  const child = spawnSync(process.execPath, ['--no-experimental-strip-types', join(root, 'scripts/example.mjs')], {encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'ready');
  await writeFile(join(root, 'extension/example.js'), 'stale');
  assert.equal(buildTypescript(root, true), false);
  let rebuilt: (() => void) | undefined;
  const changed = new Promise<void>(resolve => {rebuilt = resolve;});
  close = watchTypescript(root, () => required(rebuilt)());
  await writeFile(join(root, 'src/browser/example.ts'), 'const label: string = "after";');
  await changed;
  assert.match(await readFile(join(root, 'extension/example.js'), 'utf8'), /"after"/);
  assert.equal(buildTypescript(root, true), true);
});

test('public generated bridge loads in plain Node with native TypeScript loading disabled', () => {
  const result = spawnSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '-e', "import {annotationJobMarker} from './pi-extension/server.mjs'; console.log(annotationJobMarker('job_generated'));"], {encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '<!-- pi-web-annotator-job:job_generated -->');
});

test('AMO source archives refuse uncommitted or untracked source snapshots', () => {
  assert.doesNotThrow(() => requireCleanSource(''));
  assert.doesNotThrow(() => requireCleanSource('\n'));
  for (const status of [' M src/browser/background.ts', 'M  package.json', '?? src/browser/new.ts']) assert.throws(() => requireCleanSource(status), /clean, committed release checkout/);
});
