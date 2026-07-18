import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDemoServer } from '../scripts/serve-demo.mjs';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const readText = async (path) => readFile(new URL(path, root), 'utf8');

async function assertPathsExist(paths) {
  for (const path of paths) {
    await access(new URL(path, root));
  }
}

test('publishing metadata describes the Firefox package', async () => {
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
  assert.equal(packageJson.scripts.screenshots, 'node scripts/capture-screenshots.mjs');
  assert.equal(packageJson.scripts['demo:serve'], 'node scripts/serve-demo.mjs');
  assert.equal(packageJson.scripts['demo:video'], 'python3 evals/live-demo/run.py');
  assert.equal(packageJson.scripts['demo:gif'], 'node scripts/encode-demo-gif.mjs');
  assert.match(packageJson.scripts['demo:pi'], /^cd demo && pi /);
  assert.match(packageJson.scripts['sign:listed'], /--env-file-if-exists=\.env/);
  assert.match(packageJson.scripts['sign:listed'], /--channel listed/);
  assert.equal(packageJson.devDependencies.playwright, '1.61.1');
  assert.equal(packageJson.name, 'pi-web-annotator');
  assert.equal(packageJson.private, undefined);
  assert.deepEqual(packageJson.files, ['pi-extension/']);
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.scripts['release:validate'], 'node scripts/validate-release.mjs');
  assert.equal(
    packageJson.pi.image,
    'https://raw.githubusercontent.com/pbjorklund/pi-web-annotator/main/artwork/screenshots/pi-workflow.png',
  );
  assert.equal(
    packageJson.pi.video,
    'https://raw.githubusercontent.com/pbjorklund/pi-web-annotator/main/artwork/demo/pi-web-annotator-demo.mp4',
  );

  assert.deepEqual(metadata.categories.firefox, ['web-development']);
  assert.deepEqual(metadata.version.compatibility, ['firefox']);
  assert.equal(metadata.version.license, 'MIT');
});

test('published releases trigger the Firefox publishing workflow', async () => {
  const releaseWorkflow = await readText('.github/workflows/release.yml');
  const releasing = await readText('docs/RELEASING.md');

  assert.match(releaseWorkflow, /^\s*release:\s*$/m);
  assert.match(releaseWorkflow, /^\s*types: \[published\]\s*$/m);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch/);
  assert.match(releaseWorkflow, /^\s*contents: write\s*$/m);
  assert.match(releaseWorkflow, /github\.event\.release\.tag_name/);
  assert.doesNotMatch(releaseWorkflow, /run:.*github\.event\.release\.tag_name/);
  assert.match(releaseWorkflow, /npm run release:validate/);
  assert.match(releaseWorkflow, /gh release upload/);
  assert.match(releaseWorkflow, /npm run sign:listed/);

  assert.match(releasing, /gh release create/);
  assert.match(releasing, /release\.published/);
  assert.doesNotMatch(releasing, /run the .*workflow/i);
});

test('GitHub workflows pin actions to full commit SHAs', async () => {
  const ciWorkflow = await readText('.github/workflows/ci.yml');
  const releaseWorkflow = await readText('.github/workflows/release.yml');

  for (const workflow of [ciWorkflow, releaseWorkflow]) {
    assert.doesNotMatch(workflow, /uses: actions\/[\w-]+@v\d+/);
    assert.match(workflow, /uses: actions\/[\w-]+@[0-9a-f]{40}/);
  }
});

test('publishing surface includes required release and demo files', async () => {
  await assertPathsExist([
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.env.example',
    'CONTRIBUTING.md',
    'PRIVACY.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/AMO-LISTING.md',
    'docs/RELEASING.md',
    'demo/README.md',
    'demo/index.html',
    'demo/styles.css',
    'scripts/capture-screenshots.mjs',
    'scripts/encode-demo-gif.mjs',
    'scripts/pi-rpc-client.mjs',
    'scripts/record-live-demo.mjs',
    'scripts/run-demo-browser.mjs',
    'scripts/serve-demo.mjs',
    'evals/live-demo/cases.json',
    'evals/live-demo/eval.json',
    'evals/live-demo/run.py',
    'pi-extension/demo-sandbox.ts',
    'artwork/demo/pi-web-annotator-demo.gif',
    'artwork/demo/pi-web-annotator-demo.mp4',
    'artwork/screenshots/annotation-editor.png',
    'artwork/screenshots/annotation-panel.png',
    'artwork/screenshots/text-annotation.png',
    'artwork/screenshots/pi-workflow.png',
    'extension/annotation-storage.js',
    'extension/consent.html',
    'extension/consent.js',
    'extension/LICENSE',
    'extension/THIRD_PARTY_NOTICES.md',
    'extension/welcome.html',
    'extension/web-annotator.js',
  ]);
});

test('development files document the publishing setup', async () => {
  const packageJson = await readJson('package.json');
  const envExample = await readText('.env.example');
  assert.match(envExample, /^WEB_EXT_API_KEY=$/m);
  assert.match(envExample, /^WEB_EXT_API_SECRET=$/m);

  const gitignore = await readText('.gitignore');
  assert.match(gitignore, /^\.env$/m);

  const readme = await readText('README.md');
  assert.match(readme, /^# Web Annotator for Pi/m);
  assert.match(readme, /## Demo/);
  assert.match(readme, /npm run demo:video/);
  assert.match(readme, /img\.shields\.io\/badge\/Firefox-Download_extension/);
  assert.match(readme, /addons\.mozilla\.org\/en-US\/firefox\/addon\/web-annotator-for-pi/);
  assert.match(readme, /artwork\/demo\/pi-web-annotator-demo\.gif/);
  assert.match(readme, /artwork\/demo\/pi-web-annotator-demo\.mp4/);
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

  const demo = await readText('demo/index.html');
  assert.match(demo, /^<!doctype html>/i);
  assert.match(demo, /<html lang="en">/);
  assert.match(demo, /id="release-title"/);
  assert.match(demo, /data-testid="publish-release"/);
  assert.doesNotMatch(demo, /<script|https?:\/\//i);

  const evalRunner = await readText('evals/live-demo/run.py');
  assert.match(evalRunner, /encode-demo-gif\.mjs/);

  const recorder = await readText('scripts/record-live-demo.mjs');
  for (const marker of [
    '--mode',
    'rpc',
    '--no-session',
    '--no-context-files',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-approve',
    '--tools',
    'read,edit,write',
    'demo-sandbox.ts',
    'mkdtemp',
    'recordVideo',
    'agent_settled',
    'ffmpeg',
  ]) {
    assert.match(recorder, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const demoPi = packageJson.scripts['demo:pi'];
  for (const flag of [
    '--no-session',
    '--no-context-files',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-approve',
    '--tools read,edit,write',
    '-e ../pi-extension/index.ts',
  ]) {
    assert.match(demoPi, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('demo server exposes only the local fixture', async () => {
  const server = await startDemoServer(0);
  try {
    const page = await fetch(server.origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /id="release-title"/);

    const styles = await fetch(`${server.origin}/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /^text\/css/);

    const traversal = await fetch(`${server.origin}/%2e%2e%2fpackage.json`);
    assert.equal(traversal.status, 403);
  } finally {
    await server.close();
  }
});

test('shipped license and notices match repository sources', async () => {
  const rootLicense = await readText('LICENSE');
  const shippedLicense = await readText('extension/LICENSE');
  assert.equal(shippedLicense, rootLicense);

  const notices = await readText('THIRD_PARTY_NOTICES.md');
  const shippedNotices = await readText('extension/THIRD_PARTY_NOTICES.md');
  assert.equal(shippedNotices, notices);
  assert.match(notices, /kuzmany\/browser-annotations/);
  assert.match(notices, /Playwright/);
  assert.match(notices, /FFmpeg/);
  assert.match(notices, /web-ext/);
});

test('privacy documentation covers local and extension storage', async () => {
  const privacy = await readText('PRIVACY.md');
  assert.match(privacy, /127\.0\.0\.1:17373/);
  assert.match(privacy, /Firefox extension storage/);
  assert.match(privacy, /pi-web-annotator:collection:v1:/);
  assert.match(privacy, /private windows/i);
});
