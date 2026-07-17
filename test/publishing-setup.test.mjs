import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const readText = async (path) => readFile(new URL(path, root), 'utf8');

test('repository contains the Firefox publishing surface', async () => {
  const manifest = await readJson('extension/manifest.json');
  const packageJson = await readJson('package.json');
  const metadata = await readJson('amo-metadata.json');

  assert.equal(manifest.name, 'Web Annotator for Pi');
  assert.equal(manifest.browser_specific_settings.gecko.id, 'pi-web-annotator@pbjorklund.com');
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.optional,
    ['browsingActivity', 'websiteContent'],
  );

  assert.equal(packageJson.scripts.lint, 'web-ext lint --source-dir extension --warnings-as-errors');
  assert.match(packageJson.scripts.build, /web-ext build/);
  assert.equal(packageJson.scripts.screenshots, undefined);
  assert.match(packageJson.scripts['sign:listed'], /--env-file-if-exists=\.env/);
  assert.match(packageJson.scripts['sign:listed'], /--channel listed/);
  assert.equal(packageJson.devDependencies.playwright, undefined);
  assert.equal(packageJson.name, 'pi-web-annotator');
  assert.equal(packageJson.private, undefined);
  assert.deepEqual(packageJson.files, ['pi-extension/']);
  assert.equal(packageJson.publishConfig.access, 'public');

  assert.deepEqual(metadata.categories.firefox, ['web-development']);
  assert.deepEqual(metadata.version.compatibility, ['firefox']);
  assert.equal(metadata.version.license, 'MIT');

  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.env.example',
    'CONTRIBUTING.md',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/AMO-LISTING.md',
    'docs/RELEASING.md',
    'extension/annotation-storage.js',
    'extension/consent.html',
    'extension/consent.js',
    'extension/LICENSE',
    'extension/THIRD_PARTY_NOTICES.md',
    'extension/welcome.html',
    'extension/web-annotator.js',
  ]) {
    await access(new URL(path, root));
  }

  for (const path of [
    'scripts/capture-screenshots.mjs',
    'demo/index.html',
    'artwork/screenshots/annotation-editor.png',
    'artwork/screenshots/annotation-panel.png',
    'artwork/screenshots/text-annotation.png',
    'artwork/screenshots/pi-workflow.png',
  ]) {
    await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' });
  }

  const envExample = await readText('.env.example');
  assert.match(envExample, /^WEB_EXT_API_KEY=$/m);
  assert.match(envExample, /^WEB_EXT_API_SECRET=$/m);

  const gitignore = await readText('.gitignore');
  assert.match(gitignore, /^\.env$/m);

  const readme = await readText('README.md');
  assert.match(readme, /^# Web Annotator for Pi/m);
  assert.doesNotMatch(readme, /artwork\/screenshots|## Screenshots/);
  assert.match(readme, /## Privacy/);
  assert.match(readme, /## Attribution/);
  assert.match(readme, /THIRD_PARTY_NOTICES\.md/);
  assert.doesNotMatch(readme, /## Develop/);
  assert.doesNotMatch(readme, /## Publish to Firefox Add-ons/);

  const listing = await readText('docs/AMO-LISTING.md');
  assert.match(listing, /Firefox for Android is unsupported/);

  const contributing = await readText('CONTRIBUTING.md');
  assert.match(contributing, /## Development commands/);
  assert.match(contributing, /## Repository layout/);
  assert.match(contributing, /docs\/RELEASING\.md/);

  const rootLicense = await readText('LICENSE');
  const shippedLicense = await readText('extension/LICENSE');
  assert.equal(shippedLicense, rootLicense);

  const notices = await readText('THIRD_PARTY_NOTICES.md');
  const shippedNotices = await readText('extension/THIRD_PARTY_NOTICES.md');
  assert.equal(shippedNotices, notices);
  assert.match(notices, /kuzmany\/browser-annotations/);
  assert.doesNotMatch(notices, /Playwright/);
  assert.match(notices, /web-ext/);

  const privacy = await readText('PRIVACY.md');
  assert.match(privacy, /127\.0\.0\.1:17373/);
  assert.match(privacy, /Firefox extension storage/);
  assert.match(privacy, /pi-web-annotator:collection:v1:/);
  assert.match(privacy, /private windows/i);
});
