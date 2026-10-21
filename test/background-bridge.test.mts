import {record} from '../pi-extension/contracts.ts';
import {createBrowserFixture} from '../scripts/browser-fixture.mts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');

function loadBackground(override?: {body: unknown}) {
  type Listeners = {installed: (value: {reason: string}) => unknown; message: (value: unknown) => unknown; action: (tab: BrowserTab) => unknown; command: (command: string, tab: BrowserTab) => unknown; updated: (id: number, value: {status?: string}) => unknown; removed: (id: number) => unknown};
  const missing = (): never => {throw new Error('Missing browser listener');};
  const listeners: Listeners = {installed: missing, message: missing, action: missing, command: missing, updated: missing, removed: missing};
  const requests: {url: string; options: RequestInit}[] = [];
  const createdTabs: {url: string}[] = [];
  let dataPermissionGranted = false;
  const event = <K extends keyof Listeners>(name: K) => ({addListener(listener: Listeners[K]) {listeners[name] = listener;}});
  const browser: AnnotatorBrowser = { ...createBrowserFixture(),
    action: {
      onClicked: event('action'),
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setTitle() {},
    },
    commands: { onCommand: event('command') },
    permissions: { ...createBrowserFixture().permissions, async contains() { return dataPermissionGranted; } },
    runtime: { ...createBrowserFixture().runtime,
      getURL(path) { return `moz-extension://test/${path}`; },
      onInstalled: event('installed'),
      onMessage: event('message'),
    },
    scripting: { async executeScript() { return [{}]; } },
    tabs: {
      async create(details) { createdTabs.push(details); },
      onUpdated: event('updated'),
      onRemoved: event('removed'),
    },
  };
  async function fetch(url: string, options: RequestInit = {}) {
    requests.push({ url, options });
    const body = override ? override.body : url.endsWith('/health')
      ? { ok: true }
      : url.endsWith('/jobs/status')
        ? { jobs: { job_abcdefgh: 'in_progress' } }
        : { id: 'job_abcdefgh', status: 'sent' };
    return { ok: true, async json() { return body; } };
  }
  vm.runInNewContext(source, { AbortController, browser, clearTimeout, fetch, setTimeout });
  return {
    createdTabs,
    grantDataPermission() { dataPermissionGranted = true; },
    listeners,
    requests,
  };
}

test('background opens the welcome page only after first install', async () => {
  const state = loadBackground();

  await state.listeners.installed({ reason: 'update' });
  assert.equal(state.createdTabs.length, 0);

  await state.listeners.installed({ reason: 'install' });
  assert.equal(state.createdTabs.length, 1);
  assert.equal(state.createdTabs[0].url, 'moz-extension://test/welcome.html');
});

test('background opens bundled consent before Pi data access is granted', async () => {
  const state = loadBackground();

  const denied = record(await state.listeners.message({ type: 'pi-web-annotator-consent' }));
  assert.equal(denied.granted, false);
  assert.equal(state.createdTabs[0].url, 'moz-extension://test/consent.html');

  state.grantDataPermission();
  const granted = record(await state.listeners.message({ type: 'pi-web-annotator-consent' }));
  assert.equal(granted.granted, true);
  assert.equal(state.createdTabs.length, 1);
});

test('background relays health, job, and status messages to the Pi bridge', async () => {
  const state = loadBackground();

  const health = record(await state.listeners.message({ type: 'pi-web-annotator-health' }));
  const sent = record(await state.listeners.message({
    type: 'pi-web-annotator-send',
    job: { id: 'job_abcdefgh', prompt: 'Fix it', annotationIds: ['1'] },
  }));
  const status = record(await state.listeners.message({
    type: 'pi-web-annotator-status',
    jobIds: ['job_abcdefgh'],
  }));

  assert.equal(health.ok, true);
  assert.equal(sent.status, 'sent');
  assert.equal(record(status.jobs).job_abcdefgh, 'in_progress');
  assert.deepEqual(state.requests.map(({ url }) => url), [
    'http://127.0.0.1:17373/health',
    'http://127.0.0.1:17373/jobs',
    'http://127.0.0.1:17373/jobs/status',
  ]);
  assert.ok(state.requests.every(({ options }) => new Headers(options.headers).get('X-Pi-Web-Annotator') === '1'));
});

test('unknown message values do not trigger requests or consent', async () => {
  const state = loadBackground();
  for (const message of [null, [], false, 'pi-web-annotator-consent', {type: 1}]) assert.equal(await state.listeners.message(message), undefined);
  assert.deepEqual(state.requests, []);
  assert.deepEqual(state.createdTabs, []);
});

test('malformed bridge JSON returns failure instead of untyped state', async () => {
  const state = loadBackground({body: null});
  const response = record(await state.listeners.message({type: 'pi-web-annotator-health'}));
  assert.equal(response.ok, false);
});
