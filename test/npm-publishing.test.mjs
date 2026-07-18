import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readText = async (path) => readFile(new URL(path, root), 'utf8');

test('release workflow publishes to npm with trusted publishing', async () => {
  const workflow = await readText('.github/workflows/release.yml');

  assert.match(workflow, /^\s*id-token: write\s*$/m);
  assert.match(workflow, /^\s*registry-url: https:\/\/registry\.npmjs\.org\s*$/m);
  assert.match(workflow, /^\s*package-manager-cache: false\s*$/m);
  assert.match(workflow, /^\s*- name: Publish Pi package to npm\s*\n\s*run: npm publish\s*$/m);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});
