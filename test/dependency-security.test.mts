import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { record } from '../pi-extension/contracts.ts';
import { verifyDeepmerge } from '../scripts/verify-deepmerge.mts';

const require = createRequire(import.meta.url);
const linterRequire = createRequire(require.resolve('addons-linter'));
const imported: unknown = linterRequire('deepmerge');
if (typeof imported !== 'function') throw new Error('Missing deepmerge function');
const mergeFunction = imported;
function merge(target: unknown, source: unknown, options?: Record<string, unknown>) {
  const result: unknown = mergeFunction.call(undefined, target, source, options);
  return record(result);
}

test('linter deepmerge rejects prototype poisoning from either input and nested placeholders', () => {
  const payload: unknown = JSON.parse('{"__proto__":{"admin":true},"safe":true}');
  for (const target of [null, undefined, false, 0, '', Object.create(null), payload]) {
    const result = merge(target, payload);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.admin, undefined);
    assert.equal(Object.hasOwn(result, '__proto__'), false);
    assert.equal(result.safe, true);
  }
  for (const clone of [true, false]) {
    const result = merge(payload, { added: true }, { clone });
    assert.equal(result.admin, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.added, true);
  }
  const empty: unknown = Object.create(null);
  for (const placeholder of [null, undefined, false, 0, '', empty]) {
    const nested = record(merge({ session: placeholder }, { session: payload }).session);
    assert.equal(nested.admin, undefined);
    assert.equal(nested.safe, true);
  }
});

test('linter deepmerge skips dangerous getters and preserves ordinary keys, arrays and symbols', () => {
  const target = { list: [1], nested: { first: true } };
  const source = { list: [2], nested: { second: true }, [Symbol.for('test')]: { safe: true } };
  for (const value of [target, source]) {
    Object.defineProperty(value, '__proto__', { enumerable: true, get() { throw new Error('unsafe getter'); } });
  }
  assert.deepEqual(merge(target, source), {
    list: [1, 2], nested: { first: true, second: true }, [Symbol.for('test')]: { safe: true },
  });
  assert.deepEqual(merge(JSON.parse('{"constructor":{"a":true},"prototype":{"a":true}}'),
    JSON.parse('{"constructor":{"b":true},"prototype":{"b":true}}')),
  { constructor: { a: true, b: true }, prototype: { a: true, b: true } });
});

test('deepmerge source verification rejects removing the patch while retaining custom metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'deepmerge-integrity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL('../vendor/deepmerge/', import.meta.url), directory, { recursive: true });
  const path = join(directory, 'dist/cjs.js');
  const source = await readFile(path, 'utf8');
  const tampered = source.replace("return key !== '__proto__'", 'return true');
  assert.notEqual(tampered, source);
  await writeFile(path, tampered);
  await assert.rejects(verifyDeepmerge(directory), /Deepmerge source differs: dist\/cjs.js/);
});

test('multimatch preserves positive and negative filters with its updated minimatch API', async () => {
  const loaded: unknown = await import('multimatch');
  const match = record(loaded).default;
  if (typeof match !== 'function') throw new Error('Missing multimatch function');
  const result: unknown = match.call(undefined, ['a.js', 'b.ts', 'test/c.js', '.hidden.js'], ['**/*.js', '!test/**']);
  assert.deepEqual(result, ['a.js']);
});

test('every minimatch consumer uses bounded preprocessing and retains required matching APIs', () => {
  for (const consumer of ['eslint', '@eslint/config-array', '@eslint/eslintrc', '@typescript-eslint/typescript-estree', 'multimatch']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    const entrypoint = consumerRequire.resolve('minimatch');
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', `
      const assert = require('node:assert/strict');
      const { Minimatch, match } = require(${JSON.stringify(entrypoint)});
      const pattern = Array(10).fill('**/../a/b').join('/');
      const compiled = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
      assert.equal(compiled.set.length, 64);
      assert.deepEqual(match(['src/a.ts', 'test/b.js'], '**/*.ts'), ['src/a.ts']);
      assert.equal(new Minimatch('**/*.js', { dot: true }).match('.hidden/a.js'), true);
      assert.equal(new Minimatch('*.js', { matchBase: true }).match('src/a.js'), true);
      assert.equal(new Minimatch('*.js', { matchBase: false }).match('src/a.js'), false);
    `], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, `${consumer}: ${result.error?.message ?? result.stderr}`);
  }
});
