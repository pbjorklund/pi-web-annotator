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
  const permissionChecks: string[] = [], permissionPrompts: string[] = [];
  let dataPermissionGranted = false;
  let permissionFailure: 'throw' | 'reject' | undefined;
  const event = <K extends keyof Listeners>(name: K) => ({addListener(listener: Listeners[K]) {listeners[name] = listener;}});
  const browser: AnnotatorBrowser = { ...createBrowserFixture(),
    action: {
      onClicked: event('action'),
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setTitle() {},
    },
    commands: { onCommand: event('command') },
    permissions: {
      contains(permission) {
        permissionChecks.push(JSON.stringify(permission));
        if (permissionFailure === 'throw') throw Error('Synthetic permission API failure');
        if (permissionFailure === 'reject') return Promise.reject(Error('Synthetic permission API failure'));
        return Promise.resolve(dataPermissionGranted);
      },
      async request(permission) { permissionPrompts.push(JSON.stringify(permission)); return false; },
    },
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
    revokeDataPermission() { dataPermissionGranted = false; },
    failPermissionCheck(mode: 'throw' | 'reject') { permissionFailure = mode; },
    removePermissionAPI() { Reflect.deleteProperty(browser, 'permissions'); },
    removeContains() { Reflect.deleteProperty(browser.permissions, 'contains'); },
    permissionResponse(value: unknown) { Reflect.set(browser.permissions, 'contains', () => Promise.resolve(value)); },
    permissionChecks, permissionPrompts,
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

test('background relays health and granted job/status messages to the Pi bridge', async () => {
  const state = loadBackground();
  state.grantDataPermission();

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
  const expected = JSON.stringify({data_collection: ['browsingActivity', 'websiteContent']});
  assert.deepEqual(state.permissionChecks, [expected, expected], 'fresh checks for send and status, none for health');
  assert.deepEqual(state.permissionPrompts, []);
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

for (const type of ['pi-web-annotator-send', 'pi-web-annotator-status']) {
  const message = () => type === 'pi-web-annotator-send'
    ? {type, job: {id: 'job_abcdefgh', prompt: 'Synthetic note', annotationIds: ['1']}}
    : {type, jobIds: ['job_abcdefgh']};

  test(`${type} refuses missing permission without fetching, prompting or opening consent`, async () => {
    const state = loadBackground();
    const response = record(await state.listeners.message(message()));
    assert.equal(response.ok, false);
    assert.match(String(response.error), /permission/i);
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.createdTabs, []);
    assert.deepEqual(state.permissionPrompts, []);
  });

  test(`${type} rechecks revoked permission and permits an explicit later grant`, async () => {
    const state = loadBackground();
    state.grantDataPermission();
    assert.equal(record(await state.listeners.message(message())).ok, true);
    assert.equal(state.requests.length, 1);
    state.revokeDataPermission();
    const denied = record(await state.listeners.message(message()));
    assert.equal(denied.ok, false);
    assert.match(String(denied.error), /permission/i);
    assert.equal(state.requests.length, 1, 'prior grant must not be cached');
    assert.equal(record(await state.listeners.message({type: 'pi-web-annotator-health'})).ok, true);
    assert.equal(state.requests.length, 2);
    state.grantDataPermission();
    assert.equal(record(await state.listeners.message(message())).ok, true);
    assert.equal(state.requests.length, 3);
    assert.deepEqual(state.createdTabs, []);
    assert.deepEqual(state.permissionPrompts, []);
  });

  for (const failure of ['throw', 'reject', 'missing API', 'missing contains']) {
    test(`${type} refuses ${failure} permission checks`, async () => {
      const state = loadBackground();
      state.grantDataPermission();
      if (failure === 'throw' || failure === 'reject') state.failPermissionCheck(failure);
      else if (failure === 'missing API') state.removePermissionAPI();
      else state.removeContains();
      const response = record(await state.listeners.message(message()));
      assert.equal(response.ok, false);
      assert.match(String(response.error), /permission/i);
      assert.deepEqual(state.requests, []);
      assert.deepEqual(state.createdTabs, []);
      assert.deepEqual(state.permissionPrompts, []);
      assert.equal(record(await state.listeners.message({type: 'pi-web-annotator-health'})).ok, true);
      assert.equal(state.requests.length, 1, 'health must not depend on optional permission API');
    });
  }

  test(`${type} requires literal true rather than a truthy permission response`, async () => {
    const state = loadBackground();
    for (const value of [undefined, null, false, 1, 'true', {}, []]) {
      state.permissionResponse(value);
      assert.equal(record(await state.listeners.message(message())).ok, false);
    }
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.createdTabs, []);
    assert.deepEqual(state.permissionPrompts, []);
  });

  test(`${type} waits for permission resolution before admitting a relay`, async () => {
    const state = loadBackground();
    let release = (_value: boolean) => {};
    const permission = new Promise<boolean>(resolve => { release = resolve; });
    state.permissionResponse(permission);
    const pending = state.listeners.message(message());
    await Promise.resolve();
    assert.equal(state.requests.length, 0);
    release(false);
    assert.equal(record(await pending).ok, false);
    assert.equal(state.requests.length, 0);
  });
}

test('denied annotation relays do not serialize annotation bodies or job identifiers', async () => {
  const state = loadBackground();
  let serialized = 0;
  const payload = {toJSON() { serialized++; return ['synthetic']; }};
  for (const message of [{type: 'pi-web-annotator-send', job: payload}, {type: 'pi-web-annotator-status', jobIds: payload}])
    assert.equal(record(await state.listeners.message(message)).ok, false);
  assert.equal(serialized, 0);
  assert.equal(state.requests.length, 0);
});
