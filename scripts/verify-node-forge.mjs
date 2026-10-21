// Generated from scripts/verify-node-forge.mts; run npm run build:typescript. Do not edit.
import { record } from './../pi-extension/contracts.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const archive = join(root, 'vendor/node-forge-1.4.0.upstream.tgz');
const vendor = join(root, 'vendor/node-forge');
const patchedArchive = join(root, 'vendor/node-forge-1.4.0-pi.1.tgz');
const integrity = 'sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==';
const registryKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY6Ya7W++7aUPzvMTrezH6Ycx3c+HOKYCcNGybJZSCJq/fd7Qa8uuAKtdIkUQtQiEKERhAmE5lMMJhP8OkDOa2g==';
const registrySignature = 'MEQCIHN+qilMnh4W7N6nrRE5KXZgu26uSkmTfjPiujxr0qAvAiB2zOy5/OdnRK68PHo2WfVDpoLCo8PgFJ5pyBuWqNUO9A==';
const patchedRsaSha256 = 'acc22e5d36e27832c34e02dd3933aad7977d45b047eead5016520735efedc9c5';
const before = `          // validate DigestInfo structure and element count
          var capture = {};
          var errors = [];
          if(!asn1.validate(obj, digestInfoValidator, capture, errors) ||
            obj.value.length !== 2) {`;
const after = `          // validate DigestInfo structure and element counts (outer DigestInfo
          // and nested DigestAlgorithm). asn1.validate ignores extra children,
          // so length must be checked explicitly at each nesting level to
          // prevent low-exponent PKCS#1 v1.5 signature forgery (CVE-2026-85393).
          var capture = {};
          var errors = [];
          if(!asn1.validate(obj, digestInfoValidator, capture, errors) ||
            obj.value.length !== 2 ||
            obj.value[0].value.length !==
              (('parameters' in capture) ? 2 : 1)) {`;
async function expectedFiles() {
    const bytes = await readFile(archive);
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, integrity, 'Pristine upstream archive integrity mismatch');
    const key = createPublicKey({ key: Buffer.from(registryKey, 'base64'), format: 'der', type: 'spki' });
    assert.ok(verify('sha256', Buffer.from(`node-forge@1.4.0:${integrity}`), key, Buffer.from(registrySignature, 'base64')), 'Upstream npm registry signature invalid');
    const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    const selected = members.filter(name => /^package\/lib\/[A-Za-z0-9.-]+\.js$/.test(name)
        || ['package/LICENSE', 'package/README.md', 'package/package.json'].includes(name));
    assert.equal(selected.length, 52, 'Unexpected upstream Node source file set');
    const files = new Map();
    for (const member of selected) {
        let content = execFileSync('tar', ['-xOzf', archive, member]);
        if (member === 'package/package.json') {
            const metadata = record(JSON.parse(content.toString('utf8')));
            assert.equal(metadata.version, '1.4.0');
            metadata.version = '1.4.0-pi.1';
            metadata.piSecurityPatch = {
                upstreamVersion: '1.4.0',
                upstreamIntegrity: integrity,
                advisory: 'GHSA-86w9-cpqp-85rv',
                patchSource: 'https://github.com/digitalbazaar/forge/pull/1152',
                patchCommit: 'ceba34402e329f0365134f23fe19898756527d65',
                patchedRsaSha256,
                distribution: 'Local Node-only security backport; not an upstream release',
            };
            content = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
        }
        if (member === 'package/lib/rsa.js') {
            const source = content.toString('utf8');
            assert.equal(source.split(before).length, 2, 'Patch must match exactly once');
            content = Buffer.from(source.replace(before, after));
            assert.equal(createHash('sha256').update(content).digest('hex'), patchedRsaSha256, 'Patched rsa.js differs from pinned upstream PR #1152');
        }
        files.set(member.slice('package/'.length), content);
    }
    return files;
}
async function listFiles(directory, prefix = '') {
    const paths = [];
    for (const name of await readdir(directory)) {
        const relative = prefix + name;
        const info = await lstat(join(directory, name));
        assert.ok(!info.isSymbolicLink(), `Unexpected vendored symlink: ${relative}`);
        if (info.isDirectory())
            paths.push(...await listFiles(join(directory, name), `${relative}/`));
        else {
            assert.ok(info.isFile(), `Unexpected vendored file type: ${relative}`);
            paths.push(relative);
        }
    }
    return paths.sort();
}
export async function verifyNodeForge(directory = vendor) {
    const expected = await expectedFiles();
    assert.deepEqual(await listFiles(directory), [...expected.keys()].sort(), 'Vendored file set differs');
    for (const [name, content] of expected) {
        assert.ok((await readFile(join(directory, name))).equals(content), `Vendored source differs: ${name}`);
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
    await verifyNodeForge();
    const packed = execFileSync('tar', ['--sort=name', '--mtime=@0', '--mode=a=rX,u+w', '--owner=0', '--group=0',
        '--numeric-owner', '--format=ustar', '-czf', '-', '-C', join(root, 'vendor'), 'node-forge']);
    if (action === '--rebuild')
        await writeFile(patchedArchive, packed);
    else
        assert.ok((await readFile(patchedArchive)).equals(packed), 'Patched tarball is not reproducible from verified source');
    if (action === '--check') {
        const require = createRequire(join(root, 'package.json'));
        const webExtRequire = createRequire(require.resolve('web-ext'));
        const adbkitRequire = createRequire(webExtRequire.resolve('@devicefarmer/adbkit'));
        const installed = dirname(adbkitRequire.resolve('node-forge/package.json'));
        await verifyNodeForge(installed);
    }
    console.log('Verified pristine registry signature/integrity, exact pinned RSA patch and complete Node source tree.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
