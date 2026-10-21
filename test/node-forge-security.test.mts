import {record} from '../pi-extension/contracts.ts';
import fixture from './fixtures/node-forge-signature-forgery.json' with {type: 'json'};
import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, privateEncrypt, verify } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { verifyNodeForge } from '../scripts/verify-node-forge.mts';

const require = createRequire(import.meta.url);
const adbkitRequire = createRequire(require.resolve('@devicefarmer/adbkit'));
const imported: unknown = adbkitRequire('node-forge');
const pki = record(record(imported).pki);
const parseKey = pki.publicKeyFromPem;
if (typeof parseKey !== 'function') throw new Error('Missing public key parser');
const publicKeyFromPem = (pem: string) => {
  const value: unknown = parseKey.call(pki, pem);
  const key = record(value), exponent = record(key.e);
  const verifySignature = key.verify, intValue = exponent.intValue;
  if (typeof verifySignature !== 'function' || typeof intValue !== 'function') throw new Error('Invalid public key interface');
  return {verify(digest: string, signature: string): boolean {
    const valid: unknown = verifySignature.call(key, digest, signature);
    if (typeof valid !== 'boolean') throw new Error('Invalid verification result'); return valid;
  }, e: {intValue(): number {
    const value: unknown = intValue.call(exponent);
    if (typeof value !== 'number') throw new Error('Invalid exponent'); return value;
  }}};
}
const key = publicKeyFromPem(fixture.publicKey);
const digest = createHash('sha256').update(fixture.message).digest('binary');

test('rejects the low-exponent nested DigestAlgorithm signature forgery accepted by upstream 1.4.0', () => {
  assert.equal(key.e.intValue(), 3);
  const signature = Buffer.from(fixture.forgedSignature, 'base64');
  assert.equal(verify('sha256', Buffer.from(fixture.message), fixture.publicKey, signature), false);
  assert.throws(() => key.verify(digest, signature.toString('binary')), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
});

test('preserves valid PKCS#1 signatures and rejects a different message', () => {
  const signature = Buffer.from(fixture.validSignature, 'base64');
  assert.equal(verify('sha256', Buffer.from(fixture.message), fixture.publicKey, signature), true);
  assert.equal(key.verify(digest, signature.toString('binary')), true);
  const differentDigest = createHash('sha256').update('different message').digest('binary');
  assert.equal(key.verify(differentDigest, signature.toString('binary')), false);
});

test('accepts the OID with optional NULL but rejects extra nested children in either form', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const publicForgeKey = publicKeyFromPem(String(publicKey.export({ type: 'spki', format: 'pem' })));
  const hash = Buffer.from(digest, 'binary');
  const sequence = (value: Buffer) => Buffer.concat([Buffer.from([48, value.length]), value]);
  for (const withNull of [false, true]) {
    for (const withGarbage of [false, true]) {
      const algorithm = sequence(Buffer.concat([
        Buffer.from('0609608648016503040201', 'hex'),
        withNull ? Buffer.from('0500', 'hex') : Buffer.alloc(0),
        withGarbage ? Buffer.from('0401ff', 'hex') : Buffer.alloc(0),
      ]));
      const info = sequence(Buffer.concat([algorithm, Buffer.from([4, hash.length]), hash]));
      const encoded = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(128 - info.length - 3, 255),
        Buffer.from([0]), info]);
      const signature = privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encoded);
      const validate = () => publicForgeKey.verify(digest, signature.toString('binary'));
      if (withGarbage) assert.throws(validate, /valid RSASSA-PKCS1-v1_5 DigestInfo/);
      else assert.equal(validate(), true);
    }
  }
});

test('vendor verification rejects removal of the fix even when custom version metadata is retained', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-integrity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL('../vendor/node-forge/', import.meta.url), directory, { recursive: true });
  const path = join(directory, 'lib/rsa.js');
  const source = await readFile(path, 'utf8');
  const changed = source.replace("obj.value[0].value.length !==\n              (('parameters' in capture) ? 2 : 1)", 'false');
  assert.notEqual(source, changed);
  await writeFile(path, changed);
  await assert.rejects(verifyNodeForge(directory), /Vendored source differs: lib\/rsa.js/);
});
