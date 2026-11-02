import { record } from '../pi-extension/contracts.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = join(root, 'vendor/deepmerge-4.3.1.upstream.tgz');
const vendor = join(root, 'vendor/deepmerge');
const patchedArchive = join(root, 'vendor/deepmerge-4.3.1-pi.1.tgz');
const integrity = 'sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==';
const registryKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1Olb3zMAFFxXKHiIkQO5cJ3Yhl5i6UPp+IhuteBJbuHcA5UogKo0EWtlWwW6KSaKoTNEYL7JlCQiVnkhBktUgg==';
const registrySignature = 'MEUCIQDN993WZ4bZkA9ji9rC0yXDb/eFJLDqMXftQaUQp3hA9AIgOqjV7vLLdNtIfYCLlcugHmhK6t3rgYR+AbGZf0GzGPI=';
const patchedIndexSha256 = 'e51f441b914e5d78625f6dcb2c3c75a57daf1c221493d12808e3f0ebae14843c';
const before = 'return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))';
const after = `// Never copy __proto__: assigning it to the destination would change its prototype.
\treturn Object.keys(target).filter(function(key) {
\t\treturn key !== '__proto__'
\t}).concat(getEnumerableOwnPropertySymbols(target))`;

async function expectedFiles() {
  const bytes = await readFile(archive);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, integrity, 'Pristine deepmerge archive integrity mismatch');
  const key = createPublicKey({ key: Buffer.from(registryKey, 'base64'), format: 'der', type: 'spki' });
  assert.ok(verify('sha256', Buffer.from(`deepmerge@4.3.1:${integrity}`), key,
    Buffer.from(registrySignature, 'base64')), 'Upstream deepmerge registry signature invalid');
  const selected = ['index.js', 'index.d.ts', 'dist/cjs.js', 'dist/umd.js', 'package.json', 'license.txt', 'readme.md', 'changelog.md'];
  const files = new Map<string, Buffer>();
  for (const name of selected) {
    let content = execFileSync('tar', ['-xOzf', archive, `package/${name}`]);
    if (['index.js', 'dist/cjs.js', 'dist/umd.js'].includes(name)) {
      const source = content.toString('utf8');
      assert.equal(source.split(before).length, 2, `Patch must match exactly once in ${name}`);
      content = Buffer.from(source.replace(before, after));
      if (name === 'index.js') assert.equal(createHash('sha256').update(content).digest('hex'), patchedIndexSha256,
        'Patched index.js differs from pinned upstream PR #286');
    }
    if (name === 'package.json') {
      const metadata = record(JSON.parse(content.toString('utf8')));
      assert.equal(metadata.version, '4.3.1');
      metadata.version = '4.3.1-pi.1';
      metadata.piSecurityPatch = {
        upstreamVersion: '4.3.1', upstreamIntegrity: integrity,
        advisory: 'GHSA-gcqx-w48m-w2h4', patchSource: 'https://github.com/TehShrike/deepmerge/pull/286',
        patchCommit: '9add7d91abb595703679faf7b7942bbe7f87642b', patchedIndexSha256,
        distribution: 'Local development security backport; not an upstream release',
      };
      content = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
    }
    files.set(name, content);
  }
  return files;
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const name of await readdir(directory)) {
    const relative = prefix + name;
    const info = await lstat(join(directory, name));
    assert.ok(!info.isSymbolicLink(), `Unexpected deepmerge symlink: ${relative}`);
    if (info.isDirectory()) paths.push(...await listFiles(join(directory, name), `${relative}/`));
    else {
      assert.ok(info.isFile(), `Unexpected deepmerge file type: ${relative}`);
      paths.push(relative);
    }
  }
  return paths.sort();
}

export async function verifyDeepmerge(directory = vendor) {
  const expected = await expectedFiles();
  assert.deepEqual(await listFiles(directory), [...expected.keys()].sort(), 'Deepmerge source file set differs');
  for (const [name, content] of expected) {
    assert.ok((await readFile(join(directory, name))).equals(content), `Deepmerge source differs: ${name}`);
  }
}

async function main() {
  const action = process.argv[2] ?? '--check';
  assert.ok(['--check', '--rebuild'].includes(action), 'Use --check or --rebuild');
  if (action === '--rebuild') {
    for (const [name, content] of await expectedFiles()) {
      await mkdir(dirname(join(vendor, name)), { recursive: true });
      await writeFile(join(vendor, name), content);
    }
  }
  await verifyDeepmerge();
  const packed = execFileSync('tar', ['--sort=name', '--mtime=@0', '--mode=a=rX,u+w', '--owner=0', '--group=0',
    '--numeric-owner', '--format=ustar', '-czf', '-', '-C', join(root, 'vendor'), 'deepmerge']);
  if (action === '--rebuild') await writeFile(patchedArchive, packed);
  else assert.ok((await readFile(patchedArchive)).equals(packed), 'Deepmerge tarball is not reproducible from verified source');
  if (action === '--check') {
    const require = createRequire(join(root, 'package.json'));
    const linterRequire = createRequire(require.resolve('addons-linter'));
    await verifyDeepmerge(dirname(linterRequire.resolve('deepmerge/package.json')));
  }
  console.log('Verified deepmerge registry signature/integrity, pinned source patch, reproducible archive and installed linter dependency.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
