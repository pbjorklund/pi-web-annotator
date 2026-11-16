import assert from 'node:assert/strict';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test, {type TestContext} from 'node:test';
import {firefox, type Page} from 'playwright';
import {addBrowserFixture, createBrowserFixture} from '../scripts/browser-fixture.mts';
import {startDemoServer} from '../scripts/serve-demo.mts';

type Reply = {ok?: boolean; granted?: boolean; status?: AnnotationStatus; jobs?: Record<string, AnnotationStatus>};
type HeldCall = {kind: string; message: Record<string, unknown>; release: ((reply: Reply) => void) | undefined};
type HeldLoad = {key: string; release: ((value: Record<string, unknown>) => void) | undefined};
type ContinuationFixture = {
  calls: HeldCall[];
  loads: HeldLoad[];
  writes: Record<string, unknown>[];
  holdHealth: boolean;
  holdLoad: boolean;
  oldInstance?: AnnotatorState;
  staleDelete?: HTMLButtonElement;
  activeIntervals?: Set<number>;
  originalPush?: History['pushState'];
  originalReplace?: History['replaceState'];
};
declare global {
  var __sendContinuations: ContinuationFixture;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A browser task boundary drains the promise chains without advancing poll/toast timers.
async function flush(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

async function inject(page: Page) {
  await page.addScriptTag({path: resolve(root, 'extension/web-annotator.js')});
  await flush(page);
}

async function fixture(t: TestContext, options: {holdLoad?: boolean; holdHealth?: boolean; noInject?: boolean} = {}) {
  const demo = await startDemoServer(0);
  const browser = await firefox.launch({headless: true});
  const context = await browser.newContext({reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  t.after(async () => {
    try {
      if (!page.isClosed()) {
        await page.evaluate(() => {
          globalThis.__piWebAnnotator?.destroy?.();
          const state = globalThis.__sendContinuations;
          state.holdHealth = false;
          state.holdLoad = false;
          for (const call of state.calls) { call.release?.({ok: false, granted: false}); call.release = undefined; }
          for (const load of state.loads) { load.release?.({}); load.release = undefined; }
        });
        await flush(page);
      }
    } finally {
      await context.close();
      await browser.close();
      await demo.close();
    }
  });
  await addBrowserFixture(page, () => {
    const state: ContinuationFixture = {calls: [], loads: [], writes: [], holdHealth: false, holdLoad: false};
    globalThis.__sendContinuations = state;
    globalThis.browser = {...createBrowserFixture(),
      storage: {local: {
        async get(key) {
          if (state.holdLoad) return new Promise<Record<string, unknown>>((release) => state.loads.push({key, release}));
          return {};
        },
        async set(values) {
          state.writes.push(structuredClone(values));
        },
      }},
      runtime: {...createBrowserFixture().runtime,
        async sendMessage(message) {
          if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') {
            throw new Error('Unexpected fixture message');
          }
          const record: Record<string, unknown> = {...message};
          const kind = message.type.replace('pi-web-annotator-', '');
          const call: HeldCall = {kind, message: record, release: undefined};
          state.calls.push(call);
          if (kind === 'health' && !state.holdHealth) return {ok: true};
          return new Promise<Reply>((release) => { call.release = release; });
        },
      },
    };
  });
  await page.clock.install({time: new Date('2030-01-01T00:00:00Z')});
  await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
  await page.goto(demo.origin);
  await page.evaluate((options) => {
    globalThis.__sendContinuations.holdLoad = options.holdLoad === true;
    globalThis.__sendContinuations.holdHealth = options.holdHealth === true;
  }, options);
  await page.addScriptTag({path: resolve(root, 'extension/annotation-storage.js')});
  if (!options.noInject) await inject(page);
  return page;
}

async function seed(page: Page, count = 1) {
  await page.evaluate((count) => {
    const state = globalThis.__piWebAnnotator;
    if (!state?.ready || !state.activate) throw new Error('Annotator did not finish setup');
    state.items = Array.from({length: count}, (_, index): Annotation => ({
      id: index + 1, type: 'element', selector: 'h1', tag: 'h1', note: `Synthetic change ${index + 1}`,
      pageKey: location.href, pageUrl: location.href, rect: {x: 0, y: 0, w: 10, h: 10}, ts: 0, piStatus: 'pending',
    }));
    state.activate();
  }, count);
  await flush(page);
}

async function button(page: Page, name: string) {
  await page.getByRole('button', {name, exact: true}).evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) throw new Error('Expected button');
    node.click();
  });
  await flush(page);
}

async function checkbox(page: Page, id: number, completed: boolean) {
  await page.getByRole('checkbox', {name: `Annotation ${id}: ${completed ? 'Completed' : 'Not completed'}`, exact: true}).evaluate((node) => {
    if (!(node instanceof HTMLInputElement)) throw new Error('Expected checkbox');
    node.click();
  });
  await flush(page);
}

async function count(page: Page, kind: string) {
  return page.evaluate((kind) => globalThis.__sendContinuations.calls.filter((call) => call.kind === kind).length, kind);
}

async function release(page: Page, kind: string, index: number, reply: Reply) {
  await page.evaluate(({kind, index, reply}) => {
    const call = globalThis.__sendContinuations.calls.filter((call) => call.kind === kind)[index];
    if (!call?.release) throw new Error(`Missing held ${kind} #${index}`);
    const complete = call.release;
    call.release = undefined;
    complete(reply);
  }, {kind, index, reply});
  await flush(page);
}

async function poll(page: Page) {
  await page.clock.runFor(2_000);
  await flush(page);
}

async function rows(page: Page) {
  return page.evaluate(() => globalThis.__piWebAnnotator?.items.map((item) => ({
    id: item.id, status: item.piStatus, job: item.piJobId,
  })));
}

async function job(page: Page, id = 1) {
  const value = await page.evaluate((id) => globalThis.__piWebAnnotator?.items.find((item) => item.id === id)?.piJobId, id);
  assert.ok(value, `annotation ${id} needs a job`);
  return value;
}

async function beginSend(page: Page, id = 1) {
  await button(page, `Send annotation ${id} to Pi`);
  const consentIndex = (await count(page, 'consent')) - 1;
  await release(page, 'consent', consentIndex, {granted: true});
  assert.ok(await count(page, 'send'), 'granted consent must submit');
  return job(page, id);
}

async function destroy(page: Page) {
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator;
    if (!state?.destroy) throw new Error('Missing destroy API');
    globalThis.__sendContinuations.oldInstance = state;
    state.destroy();
  });
  await flush(page);
}

async function effects(page: Page) {
  return page.evaluate(() => ({
    requests: globalThis.__sendContinuations.calls.length,
    writes: globalThis.__sendContinuations.writes.length,
    ui: document.querySelectorAll('[data-bh-ui]').length,
    installed: globalThis.__piWebAnnotator !== undefined,
  }));
}

test('shared-row overlap while consent is held never submits twice, including after a failed first POST', async (t) => {
  const page = await fixture(t);
  await seed(page);
  await button(page, 'Send annotation 1 to Pi');
  assert.equal(await count(page, 'consent'), 1);
  await button(page, 'Send to Pi');
  // Release the owner first, fail its POST, then grant any incorrectly queued overlap.
  await release(page, 'consent', 0, {granted: true});
  await release(page, 'send', 0, {ok: false});
  const consents = await count(page, 'consent');
  for (let index = 1; index < consents; index++) await release(page, 'consent', index, {granted: true});
  assert.equal(await count(page, 'send'), 1, 'overlap must not replay after an uncertain failed POST');
  assert.equal(consents, 1, 'overlap must return before requesting another consent');
  assert.deepEqual(await rows(page), [{id: 1, status: 'pending', job: undefined}]);
  await poll(page); // Reconnect, but never automatically retry the uncertain POST.
  assert.equal(await count(page, 'send'), 1);
  const retryJob = await beginSend(page);
  await release(page, 'send', 1, {ok: true, status: 'sent'});
  assert.deepEqual(await rows(page), [{id: 1, status: 'sent', job: retryJob}]);
});

test('disjoint rows progress independently while the first consent remains held', async (t) => {
  const page = await fixture(t);
  await seed(page, 2);
  await button(page, 'Send annotation 1 to Pi');
  await button(page, 'Send annotation 2 to Pi');
  assert.equal(await count(page, 'consent'), 2);
  await release(page, 'consent', 1, {granted: true});
  await release(page, 'send', 0, {ok: true, status: 'sent'});
  const secondJob = await job(page, 2);
  assert.deepEqual(await rows(page), [{id: 1, status: 'pending', job: undefined}, {id: 2, status: 'sent', job: secondJob}]);
  await release(page, 'consent', 0, {granted: true});
  await release(page, 'send', 1, {ok: true, status: 'sent'});
  assert.notEqual(await job(page), secondJob);
  assert.equal(await count(page, 'send'), 2);
});

for (const action of ['clear', 'delete', 'checkbox ABA']) {
  test(`${action} invalidates a row selected before held consent`, async (t) => {
    const page = await fixture(t);
    await seed(page);
    await button(page, 'Send annotation 1 to Pi');
    assert.equal(await count(page, 'consent'), 1);
    if (action === 'clear') {
      page.once('dialog', (dialog) => { void dialog.accept(); });
      await button(page, 'Clear');
    } else if (action === 'delete') {
      await button(page, 'Delete annotation 1');
    } else {
      await checkbox(page, 1, false);
      await checkbox(page, 1, true);
    }
    await release(page, 'consent', 0, {granted: true});
    assert.equal(await count(page, 'send'), 0, 'late consent cannot resurrect an invalidated selection');
    assert.deepEqual(await rows(page), action === 'checkbox ABA' ? [{id: 1, status: 'pending', job: undefined}] : []);
  });
}

test('denial does not replay; explicit retry grants and queues a normal send', async (t) => {
  const page = await fixture(t);
  await seed(page);
  await button(page, 'Send annotation 1 to Pi');
  await release(page, 'consent', 0, {granted: false});
  await poll(page);
  assert.equal(await count(page, 'send'), 0);
  assert.equal(await count(page, 'consent'), 1, 'health polling must not retry a denied send');
  const id = await beginSend(page);
  await release(page, 'send', 0, {ok: true, status: 'sent'});
  assert.deepEqual(await rows(page), [{id: 1, status: 'sent', job: id}]);
  assert.equal(await count(page, 'consent'), 2);
  assert.equal(await count(page, 'send'), 1);
  assert.equal(await page.getByRole('button', {name: 'Send annotation 1 to Pi', exact: true}).isDisabled(), true);
});

for (const response of [{ok: true, status: 'sent'}, {ok: false}] satisfies Reply[]) {
  test(`polled progress/completion owns state before late POST ${response.ok ? 'sent' : 'failure'}`, async (t) => {
    const page = await fixture(t);
    await seed(page, 4);
    const firstJob = await beginSend(page, 1);
    const secondJob = await beginSend(page, 2);
    const thirdJob = await beginSend(page, 3);
    await poll(page);
    await release(page, 'status', 0, {ok: true, jobs: {
      [firstJob]: 'in_progress', [secondJob]: 'completed', [thirdJob]: 'completed',
    }});
    // A manual checkbox ABA also invalidates the still-held POST's row ownership.
    await checkbox(page, 3, true);
    await checkbox(page, 3, false);
    await checkbox(page, 3, true);
    const replacementJob = await beginSend(page, 3);
    assert.notEqual(replacementJob, thirdJob);
    for (let index = 0; index < 3; index++) await release(page, 'send', index, response);
    assert.deepEqual(await rows(page), [
      {id: 1, status: 'in_progress', job: firstJob},
      {id: 2, status: 'completed', job: secondJob},
      {id: 3, status: 'sending', job: replacementJob},
      {id: 4, status: 'pending', job: undefined},
    ], 'late POST must not overwrite polled progress/completion or a manually retried new job');
    assert.equal(await page.getByRole('button', {name: 'Send annotation 4 to Pi', exact: true}).isDisabled(), false,
      'a stale failed POST cannot disconnect a healthy, newer UI');
    await release(page, 'send', 3, {ok: true, status: 'sent'});
    await poll(page);
    await release(page, 'status', 1, {ok: true, jobs: {
      [firstJob]: 'completed', [secondJob]: 'completed', [replacementJob]: 'sent',
    }});
    assert.deepEqual(await rows(page), [
      {id: 1, status: 'completed', job: firstJob},
      {id: 2, status: 'completed', job: secondJob},
      {id: 3, status: 'sent', job: replacementJob},
      {id: 4, status: 'pending', job: undefined},
    ]);
  });
}

test('held old status cannot reset job B or apply to an unqueried/replaced row', async (t) => {
  const page = await fixture(t);
  await seed(page, 2);
  await button(page, 'Send to Pi');
  await release(page, 'consent', 0, {granted: true});
  const oldJob = await job(page);
  await release(page, 'send', 0, {ok: true, status: 'sent'});
  await poll(page);
  assert.equal(await count(page, 'status'), 1);
  assert.deepEqual(await page.evaluate(() => globalThis.__sendContinuations.calls.find((call) => call.kind === 'status')?.message.jobIds), [oldJob]);
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator;
    if (!state?.activate) throw new Error('Missing state');
    state.items[0].piStatus = 'completed';
    state.activate();
  });
  await checkbox(page, 1, true);
  const newJob = await beginSend(page);
  await release(page, 'send', 1, {ok: true, status: 'sent'});
  assert.notEqual(newJob, oldJob);
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator;
    if (!state?.activate) throw new Error('Missing state');
    const original = state.items[0];
    state.items[1] = {...state.items[1]}; // Same ID/job, different object than the queried row.
    state.items.push({...original, id: 3, piJobId: 'unqueried-job', piStatus: 'sent'});
    state.activate();
  });
  await release(page, 'status', 0, {ok: true, jobs: {[oldJob]: 'completed', 'unqueried-job': 'completed'}});
  assert.deepEqual(await rows(page), [
    {id: 1, status: 'sent', job: newJob},
    {id: 2, status: 'sent', job: oldJob},
    {id: 3, status: 'sent', job: 'unqueried-job'},
  ], 'only the snapshotted row identity/job/revision may consume an old response');
});

test('destroy fences held health, status, consent and POST continuations', async (t) => {
  for (const boundary of ['health', 'status', 'consent', 'send']) {
    await t.test(boundary, async (t) => {
      const page = await fixture(t, {holdHealth: boundary === 'health'});
      await seed(page);
      if (boundary === 'health') {
        await page.evaluate(() => {
          const state = globalThis.__piWebAnnotator;
          if (!state?.activate) throw new Error('Missing state');
          state.items[0].piJobId = 'synthetic-existing-job';
          state.items[0].piStatus = 'sent';
          state.activate();
        });
      }
      let id: string | undefined;
      if (boundary === 'status' || boundary === 'send') id = await beginSend(page);
      if (boundary === 'status') {
        await release(page, 'send', 0, {ok: true, status: 'sent'});
        await poll(page);
      }
      if (boundary === 'consent') await button(page, 'Send annotation 1 to Pi');
      assert.equal(await count(page, boundary), 1, 'the async boundary must actually be held');
      const beforeRows = await rows(page);
      await destroy(page);
      const before = await effects(page);
      await release(page, boundary, 0, boundary === 'consent' ? {granted: true}
        : boundary === 'status' && id ? {ok: true, jobs: {[id]: 'completed'}} : {ok: true, status: 'sent'});
      await page.clock.runFor(10_000);
      await flush(page);
      // Exercise formerly installed document/route listeners too.
      await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', altKey: true, bubbles: true}));
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.dispatchEvent(new Event('resize'));
      });
      await page.clock.runFor(2_000);
      await flush(page);
      assert.deepEqual(await effects(page), before, 'destroy must prevent further requests, storage writes and UI');
      assert.deepEqual(await page.evaluate(() => globalThis.__sendContinuations.oldInstance?.items.map((item) => ({
        id: item.id, status: item.piStatus, job: item.piJobId,
      }))), beforeRows, 'a late response must not mutate the destroyed instance');
    });
  }
});

test('destroyed setup cannot mount over or delete a reinjected instance when old loads finish', async (t) => {
  const page = await fixture(t, {holdLoad: true});
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.loads.length), 2);
  await destroy(page);
  await page.evaluate(() => { globalThis.__sendContinuations.holdLoad = false; });
  await inject(page);
  await seed(page);
  const before = await effects(page);
  await page.evaluate(() => {
    for (const load of globalThis.__sendContinuations.loads) {
      load.release?.({});
      load.release = undefined;
    }
  });
  await flush(page);
  assert.deepEqual(await effects(page), before, 'late setup cannot mount a second panel or restart polling');
  assert.equal(await page.locator('#bh-panel').count(), 1);
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.oldInstance?.ready), false);
  await page.evaluate(() => { globalThis.__sendContinuations.oldInstance?.destroy?.(); });
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator?.ready), true, 'old destroy cannot delete the new namespace');
  assert.deepEqual(await rows(page), [{id: 1, status: 'pending', job: undefined}]);
  await poll(page);
  assert.equal((await effects(page)).requests, before.requests + 1, 'only the current instance polls');
});

test('destroy removes a deferred DOMContentLoaded mount', async (t) => {
  const page = await fixture(t, {noInject: true});
  // The demo is already loaded: temporarily remove its body to deterministically reach
  // the real no-body setup branch without intercepting readyState or production hooks.
  await page.evaluate(() => { document.body.remove(); });
  await inject(page);
  assert.equal(await page.locator('#bh-panel').count(), 0);
  await destroy(page);
  const before = await effects(page);
  await page.evaluate(() => {
    document.documentElement.appendChild(document.createElement('body'));
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  await flush(page);
  await page.clock.runFor(4_000);
  await flush(page);
  assert.deepEqual(await effects(page), before, 'a deferred mount must not survive destroy');
});

test('mounted replacement retires old controls and intervals without damaging successor marks', async (t) => {
  const page = await fixture(t, {noInject: true});
  await page.evaluate(() => {
    const active = new Set<number>();
    globalThis.__sendContinuations.activeIntervals = active;
    globalThis.__sendContinuations.originalPush = history.pushState;
    globalThis.__sendContinuations.originalReplace = history.replaceState;
    const timers: Window = window;
    const start = timers.setInterval.bind(timers), stop = timers.clearInterval.bind(timers);
    timers.setInterval = (handler, timeout, ...args: unknown[]) => { const id = start(handler, timeout, ...args); active.add(id); return id; };
    timers.clearInterval = (id) => { if (id !== undefined) active.delete(id); stop(id); };
  });
  await inject(page);
  await seed(page);
  await page.evaluate(() => {
    const node = document.querySelector('[aria-label="Delete annotation 1"]');
    if (!(node instanceof HTMLButtonElement)) throw Error('Missing stale control');
    globalThis.__sendContinuations.staleDelete = node;
    globalThis.__sendContinuations.oldInstance = globalThis.__piWebAnnotator;
    delete globalThis.__piWebAnnotator;
  });
  await inject(page);
  assert.equal(await page.locator('#bh-panel').count(), 1, 'replacement must remove the mounted predecessor');
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.activeIntervals?.size), 1,
    'only the successor polling interval may remain');
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator, heading = document.querySelector('h1'), selection = window.getSelection();
    if (!state?.activate || !heading || !selection) throw Error('Missing current capture fixture');
    state.targetMode = 'text';
    state.activate();
    const range = document.createRange();
    range.selectNodeContents(heading);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  });
  await page.clock.runFor(220);
  await flush(page);
  assert.equal(await page.locator('mark[data-bh-anno-id="1"]').count(), 1);
  await page.evaluate(() => globalThis.__sendContinuations.staleDelete?.click());
  await flush(page);
  assert.equal(await page.locator('mark[data-bh-anno-id="1"]').count(), 1, 'stale Delete cannot remove the successor mark');
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.oldInstance?.items.length), 1,
    'stale controls must not mutate retired rows');
  await destroy(page);
  assert.equal(await page.locator('#bh-panel').count(), 0);
  assert.equal(await page.locator('mark[data-bh-anno-id]').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.activeIntervals?.size), 0);
  assert.equal(await page.evaluate(() => history.pushState === globalThis.__sendContinuations.originalPush
    && history.replaceState === globalThis.__sendContinuations.originalReplace), true,
  'successor teardown must not restore a retired predecessor wrapper');
});

test('a replaced namespace fences old setup, listeners and teardown', async (t) => {
  const page = await fixture(t, {holdLoad: true});
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator;
    if (!state) throw Error('Missing state');
    state.mode = false;
    globalThis.__sendContinuations.oldInstance = state;
    delete globalThis.__piWebAnnotator;
    globalThis.__sendContinuations.holdLoad = false;
  });
  await inject(page);
  await seed(page);
  const before = await effects(page);
  await page.evaluate(() => {
    for (const load of globalThis.__sendContinuations.loads) {
      load.release?.({});
      load.release = undefined;
    }
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', altKey: true, bubbles: true}));
  });
  await flush(page);
  assert.deepEqual(await effects(page), before, 'old setup must not mount or poll in the new namespace');
  assert.equal(await page.evaluate(() => globalThis.__sendContinuations.oldInstance?.mode), false,
    'old document listeners must be inert after namespace replacement');
  await page.evaluate(() => {
    const mark = document.createElement('mark');
    mark.dataset.bhAnnoId = '1';
    mark.textContent = 'Synthetic replacement-instance mark';
    document.body.appendChild(mark);
    globalThis.__sendContinuations.oldInstance?.destroy?.();
  });
  assert.equal(await page.locator('#bh-panel').count(), 1);
  assert.equal(await page.locator('mark[data-bh-anno-id="1"]').count(), 1,
    'old teardown must not remove replacement-instance marks');
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator?.ready), true);
});

test('late health cannot overwrite a newer successful send connection', async (t) => {
  const page = await fixture(t);
  await seed(page, 2);
  const id = await beginSend(page);
  await page.evaluate(() => { globalThis.__sendContinuations.holdHealth = true; });
  await poll(page);
  assert.equal(await count(page, 'health'), 2);
  await release(page, 'send', 0, {ok: true, status: 'sent'});
  await release(page, 'health', 1, {ok: false});
  assert.equal(await page.getByRole('button', {name: 'Send annotation 2 to Pi', exact: true}).isDisabled(), false);
  assert.equal(await page.getByRole('status', {name: 'Pi connected', exact: true}).count(), 1);
  assert.deepEqual(await rows(page), [{id: 1, status: 'sent', job: id}, {id: 2, status: 'pending', job: undefined}]);
});

test('an older send flash cannot erase newer failure feedback', async (t) => {
  const page = await fixture(t);
  await seed(page);
  await button(page, 'Send to Pi');
  await release(page, 'consent', 0, {granted: true});
  await release(page, 'send', 0, {ok: true, status: 'sent'});
  await page.evaluate(() => {
    const state = globalThis.__piWebAnnotator;
    if (!state?.activate) throw Error('Missing state');
    const item: Annotation = {...state.items[0], id: 2, note: 'Synthetic second change', piStatus: 'pending'};
    delete item.piJobId;
    state.items.push(item);
    state.activate();
  });
  await page.clock.runFor(1_000);
  await button(page, 'Sent');
  await release(page, 'consent', 1, {granted: true});
  await release(page, 'send', 1, {ok: false});
  assert.equal(await page.getByRole('button', {name: 'Failed', exact: true}).count(), 1);
  await page.clock.runFor(201);
  await flush(page);
  assert.equal(await page.getByRole('button', {name: 'Failed', exact: true}).count(), 1,
    'the first send timer must not clear the second send feedback');
});
