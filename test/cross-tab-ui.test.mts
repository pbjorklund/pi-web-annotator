import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test, {type TestContext} from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {firefox, type Page} from 'playwright';
import {addBrowserFixture, createBrowserFixture} from '../scripts/browser-fixture.mts';
import {startDemoServer} from '../scripts/serve-demo.mts';
import {record} from '../pi-extension/contracts.ts';

type ChangeListener = (changes: StorageChanges, area: string) => void;
type Transport = {kind: 'get'; key: string} | {kind: 'set'; values: Record<string, unknown>} | {kind: 'runtime'; message: unknown};
declare global {
  var __crossTabTransport: (request: Transport) => Promise<unknown>;
  var __crossTabEvents: {listeners: Set<ChangeListener>; retired: ChangeListener[]};
}
const artifact = (name: string) => fileURLToPath(new URL(`../extension/${name}.js`, import.meta.url));
const backgroundSource = ts.transpileModule(await readFile(new URL('../src/browser/background.ts', import.meta.url), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
}).outputText;
function deferred() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}

async function inject(page: Page) {
  await page.addScriptTag({path: artifact('annotation-storage')});
  await page.addScriptTag({path: artifact('web-annotator')});
  await page.waitForFunction(() => globalThis.__piWebAnnotator?.ready === true);
}

// Two real pages, one registered production background handler, one isolated store.
// Only the Firefox transport/storage edge is synthetic; no extension profile or Pi is used.
async function fixture(t: TestContext, options: {connected?: boolean} = {}) {
  const demo = await startDemoServer(0);
  t.after(() => demo.close());
  const browser = await firefox.launch({headless: true});
  t.after(() => browser.close());
  const context = await browser.newContext({reducedMotion: 'reduce'});
  const pages = [await context.newPage(), await context.newPage()] as const;
  const key = `pi-web-annotator:collection:v2:${demo.origin}`;
  const values: Record<string, unknown> = {};
  const writes: Record<string, unknown>[] = [];
  const calls: {page: Page; message: unknown}[] = [];
  const jobs: {id: string; prompt: string; annotationIds: string[]}[] = [];
  let heldReply: {page: Page; kind: string; entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred>} | undefined;
  const heldNotifications = new Set<Page>();
  const notifications = new Map<Page, StorageChanges[]>();
  const operationWaiters: {page: Page; kind: string; event: ReturnType<typeof deferred>}[] = [];
  let failReads = false, rejectNextWrite = false;
  let heldWrite: {entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred>} | undefined;
  let handler: (message: unknown, sender?: {url?: string}) => unknown = () => {throw Error('Background did not register');};

  async function deliver(page: Page, changes: StorageChanges, retired = false) {
    if (page.isClosed()) return;
    await page.evaluate(({changes, retired}) => {
      const state = globalThis.__crossTabEvents;
      for (const listener of retired ? state.retired : state.listeners) listener(changes, 'local');
    }, {changes: structuredClone(changes), retired});
  }
  async function get(name: string) {
    if (failReads && name.startsWith('pi-web-annotator:collection:')) throw Error('Synthetic storage read failure');
    return structuredClone({[name]: values[name]});
  }
  async function set(update: Record<string, unknown>) {
    // Clone at admission as well as at persistence: neither caller nor reader owns stored objects.
    const cloned = structuredClone(update);
    if (Object.hasOwn(cloned, key)) {
      const gate = heldWrite;
      if (gate) {heldWrite = undefined; gate.entered.release(); await gate.resume.promise;}
      if (rejectNextWrite) {rejectNextWrite = false; throw Error('Synthetic storage write failure');}
    }
    const changes: StorageChanges = {};
    for (const name of Object.keys(cloned)) {
      changes[name] = {oldValue: structuredClone(values[name]), newValue: structuredClone(cloned[name])};
      values[name] = structuredClone(cloned[name]);
    }
    writes.push(structuredClone(cloned));
    await Promise.all(pages.map(async page => {
      if (heldNotifications.has(page)) {
        const queue = notifications.get(page) ?? [];
        queue.push(structuredClone(changes)); notifications.set(page, queue);
      } else await deliver(page, changes);
    }));
  }
  const base = createBrowserFixture();
  vm.runInNewContext(backgroundSource, {
    browser: {...base, storage: {local: {get, set}}, runtime: {...base.runtime, onMessage: {addListener(listener: typeof handler) {handler = listener;}}}},
    URL, AbortController, setTimeout, clearTimeout,
    fetch() {throw Error('Cross-tab tests must never contact the Pi bridge');},
  });
  for (const page of pages) {
    page.setDefaultTimeout(5_000);
    await page.exposeBinding('__crossTabTransport', async ({page: sender}, request: Transport) => {
      if (request.kind === 'get') return get(request.key);
      if (request.kind === 'set') return set(request.values);
      const message = structuredClone(request.message);
      calls.push({page: sender, message});
      if (!message || typeof message !== 'object' || !('type' in message)) return {ok: false};
      if (message.type !== 'pi-web-annotator-storage') {
        if (!options.connected) return {ok: false};
        if (message.type === 'pi-web-annotator-health') return {ok: true};
        if (message.type === 'pi-web-annotator-consent') return {granted: true};
        if (message.type === 'pi-web-annotator-send' && 'job' in message) {
          const job = record(message.job);
          if (typeof job.id !== 'string' || typeof job.prompt !== 'string' || !Array.isArray(job.annotationIds)) throw Error('Invalid synthetic job');
          const ids: unknown[] = job.annotationIds, annotationIds: string[] = [];
          for (const id of ids) {if (typeof id !== 'string') throw Error('Invalid synthetic annotation ID'); annotationIds.push(id);}
          jobs.push({id: job.id, prompt: job.prompt, annotationIds});
          return {ok: true, status: 'sent'};
        }
        return {ok: false};
      }
      if ('operation' in message && message.operation && typeof message.operation === 'object' && 'kind' in message.operation) {
        for (const waiter of operationWaiters) if (waiter.page === sender && waiter.kind === message.operation.kind) waiter.event.release();
      }
      const reply = await handler(message, {url: sender.url()});
      const gate = heldReply;
      if (gate && gate.page === sender && 'operation' in message && record(message.operation).kind === gate.kind) {
        heldReply = undefined; gate.entered.release(); await gate.resume.promise;
      }
      return structuredClone(reply);
    });
    await addBrowserFixture(page, () => {
      const state: {listeners: Set<ChangeListener>; retired: ChangeListener[]} = {listeners: new Set(), retired: []};
      globalThis.__crossTabEvents = state;
      const base = createBrowserFixture();
      globalThis.browser = {...base,
        storage: {
          local: {
            async get(key) {
              const value = await globalThis.__crossTabTransport({kind: 'get', key});
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid fixture storage reply');
              return {...value};
            },
            async set(values) {await globalThis.__crossTabTransport({kind: 'set', values});},
          },
          onChanged: {
            addListener(listener) {state.listeners.add(listener);},
            removeListener(listener) {state.listeners.delete(listener); state.retired.push(listener);},
          },
        },
        runtime: {...base.runtime, sendMessage(message) {return globalThis.__crossTabTransport({kind: 'runtime', message});}},
      };
    }, {externalStorageBroker: true});
    await page.goto(demo.origin);
  }
  await Promise.all(pages.map(inject));
  return {
    pages, key, values, writes, calls, jobs,
    holdReply(page: Page, kind: string) {
      assert.equal(heldReply, undefined);
      const gate = {page, kind, entered: deferred(), resume: deferred()}; heldReply = gate;
      t.after(() => gate.resume.release());
      return gate;
    },
    snapshot() {
      const value = structuredClone(values[key]);
      if (value === undefined) return undefined;
      const snapshot = record(value);
      assert.equal(snapshot.schema, 2);
      assert.equal(typeof snapshot.revision, 'number');
      assert.equal(typeof snapshot.nextId, 'number');
      assert.ok(Array.isArray(snapshot.rows));
      return {revision: snapshot.revision, nextId: snapshot.nextId, rows: snapshot.rows.map(row => {
        const saved = record(row);
        return {revision: saved.revision, annotation: record(saved.annotation)};
      })};
    },
    holdWrite() {
      assert.equal(heldWrite, undefined);
      const gate = {entered: deferred(), resume: deferred()}; heldWrite = gate;
      t.after(() => gate.resume.release());
      return gate;
    },
    rejectWrite() {rejectNextWrite = true;},
    failReads(value: boolean) {failReads = value;},
    operation(page: Page, kind: string) {
      const event = deferred(); operationWaiters.push({page, kind, event}); return event.promise;
    },
    holdEvents(page: Page) {heldNotifications.add(page);},
    async releaseEvents(page: Page, retired = false) {
      heldNotifications.delete(page);
      const queue = notifications.get(page) ?? []; notifications.delete(page);
      for (const changes of queue) await deliver(page, changes, retired);
    },
  };
}
const note = (page: Page) => page.getByLabel('Annotation note', {exact: true});
const save = (page: Page) => page.getByRole('button', {name: 'Save', exact: true});
const alert = (page: Page) => page.getByRole('alert', {name: 'Annotation storage', exact: true});
async function draft(page: Page, text: string) {
  await page.locator('h1').click();
  await note(page).fill(text);
  assert.equal(await note(page).getAttribute('placeholder'), 'Note for this element…');
}
async function edit(page: Page, id: number, text: string) {
  await page.getByRole('button', {name: `Edit annotation ${id}`, exact: true}).click();
  await note(page).fill(text);
}
async function visibleRows(page: Page, expected: [number, string][]) {
  await page.waitForFunction(expected => JSON.stringify(globalThis.__piWebAnnotator?.items.map(a => [a.id, a.note])) === JSON.stringify(expected), expected);
  for (const [id, text] of expected) {
    assert.equal(await page.getByRole('button', {name: `Delete annotation ${id}`, exact: true}).count(), 1);
    assert.ok(await page.locator('#bh-panel').getByText(text, {exact: true}).isVisible());
  }
  assert.equal(await page.locator('#bh-panel button[aria-label^="Delete annotation "]').count(), expected.length);
}
async function create(page: Page, text: string) {
  await draft(page, text); await save(page).click();
  await page.getByRole('dialog', {name: 'Add annotation', exact: true}).waitFor({state: 'hidden'});
}
async function reload(page: Page) {await page.reload(); await inject(page);}
function savedRows(state: Awaited<ReturnType<typeof fixture>>) {
  return state.snapshot()?.rows.map(row => {
    const annotation = row.annotation;
    return [annotation.id, annotation.note];
  }) ?? [];
}
async function conflict(page: Page, draftText: string) {
  await alert(page).waitFor({state: 'visible'});
  assert.match(await alert(page).innerText(), /not saved|unconfirmed/i);
  assert.match(await alert(page).innerText(), /another tab|changed|reload/i);
  assert.equal(await note(page).inputValue(), draftText);
  assert.ok(await save(page).isDisabled());
  assert.ok(await page.getByRole('button', {name: 'Reload saved annotations', exact: true}).isVisible());
}

for (const removed of [[1], [1, 2]]) {
  test(`batch send excludes rows deleted after persistence but before its reply (${removed.join(',')})`, {timeout: 30_000}, async t => {
    const state = await fixture(t, {connected: true}), [a, b] = state.pages;
    await create(a, 'Withdrawn before dispatch');
    await create(a, 'Remaining selected note');
    await visibleRows(b, [[1, 'Withdrawn before dispatch'], [2, 'Remaining selected note']]);
    const gate = state.holdReply(a, 'updateMany');
    const sending = a.getByRole('button', {name: 'Send to Pi', exact: true});
    assert.equal(await sending.isDisabled(), false);
    const attempt = sending.evaluate(async node => {
      if (!(node instanceof HTMLButtonElement) || !node.onclick) throw Error('Missing registered Send handler');
      const result: unknown = node.onclick.call(node, new PointerEvent('click'));
      await result;
    });
    try {
      await gate.entered.promise;
      for (const id of removed) {
        await b.getByRole('button', {name: `Delete annotation ${id}`, exact: true}).click();
        await b.waitForFunction(id => !globalThis.__piWebAnnotator?.items.some(item => item.id === id), id);
      }
      gate.resume.release(); await attempt;
      if (removed.length === 2) assert.deepEqual(state.jobs, [], 'no valid selection means no submission');
      else {
        assert.equal(state.jobs.length, 1);
        assert.deepEqual(state.jobs[0].annotationIds, ['2']);
        assert.doesNotMatch(state.jobs[0].prompt, /Withdrawn before dispatch/);
        assert.match(state.jobs[0].prompt, /Remaining selected note/);
      }
    } finally {gate.resume.release(); await attempt.catch(() => {});}
  });
}

test('pending text marks survive unrelated remote create/delete operations', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  await a.evaluate(() => {
    const current = globalThis.__piWebAnnotator, selection = window.getSelection();
    if (!current?.activate || !selection) throw Error('Missing text capture fixture');
    const target = document.createElement('p');
    target.id = 'synthetic-pending-text'; target.textContent = 'Synthetic pending text selection'; document.body.appendChild(target);
    current.targetMode = 'text'; current.activate();
    const range = document.createRange(); range.selectNodeContents(target);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  });
  await note(a).waitFor({state: 'visible'});
  await note(a).fill('Retained text draft');
  assert.equal(await a.locator('mark[data-bh-anno-id]').count(), 1);
  await create(b, 'Unrelated remote note');
  await visibleRows(a, [[1, 'Unrelated remote note']]);
  await b.getByRole('button', {name: 'Delete annotation 1', exact: true}).click();
  await Promise.all(state.pages.map(page => visibleRows(page, [])));
  assert.equal(await a.locator('mark[data-bh-anno-id]').count(), 1, 'remote deletion must not unwrap the unrelated pending capture');
  assert.equal(await note(a).inputValue(), 'Retained text draft');
  await save(a).click();
  await a.getByRole('dialog', {name: 'Add annotation', exact: true}).waitFor({state: 'hidden'});
  const expected: [number, string][] = [[2, 'Retained text draft']];
  await Promise.all(state.pages.map(page => visibleRows(page, expected)));
  assert.equal(await a.locator('mark[data-bh-anno-id="2"]').count(), 1);
  assert.deepEqual(savedRows(state), expected);
});

test('concurrent tab-local creates wait for confirmation and receive distinct broker IDs', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  await Promise.all([draft(a, 'First tab'), draft(b, 'Second tab')]);
  const gate = state.holdWrite();
  await save(a).click(); await gate.entered.promise;
  const second = state.operation(b, 'create');
  await save(b).click(); await second;
  assert.equal(state.snapshot(), undefined);
  await Promise.all([visibleRows(a, []), visibleRows(b, [])]);
  assert.equal(await note(a).inputValue(), 'First tab');
  assert.equal(await note(b).inputValue(), 'Second tab');
  const proposals = state.calls.flatMap(({message}) => {
    if (!message || typeof message !== 'object' || !('operation' in message)) return [];
    const operation = record(message.operation);
    return operation.kind === 'create' ? [record(operation.annotation).id] : [];
  });
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0], proposals[1], 'both tabs began from the same local ID state');
  gate.resume.release();
  const expected: [number, string][] = [[1, 'First tab'], [2, 'Second tab']];
  await Promise.all(state.pages.map(page => visibleRows(page, expected)));
  assert.deepEqual(savedRows(state), expected);
  assert.equal(state.snapshot()?.nextId, 3);
  await Promise.all(state.pages.map(reload));
  await Promise.all(state.pages.map(page => visibleRows(page, expected)));
});

test('disjoint edits and deletes survive cross-tab events and full reload', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  for (const text of ['One', 'Two', 'Three']) await create(a, text);
  await visibleRows(b, [[1, 'One'], [2, 'Two'], [3, 'Three']]);
  await edit(a, 1, 'One edited');
  const gate = state.holdWrite();
  await save(a).click(); await gate.entered.promise;
  const removing = state.operation(b, 'delete');
  await b.getByRole('button', {name: 'Delete annotation 2', exact: true}).click(); await removing;
  await visibleRows(a, [[1, 'One'], [2, 'Two'], [3, 'Three']]);
  await visibleRows(b, [[1, 'One'], [2, 'Two'], [3, 'Three']]);
  gate.resume.release();
  await visibleRows(b, [[1, 'One edited'], [3, 'Three']]);
  await edit(b, 3, 'Three edited'); await save(b).click();
  const expected: [number, string][] = [[1, 'One edited'], [3, 'Three edited']];
  await visibleRows(a, expected);
  assert.deepEqual(savedRows(state), expected);
  await Promise.all(state.pages.map(reload));
  await Promise.all(state.pages.map(page => visibleRows(page, expected)));
});

for (const remote of ['edit', 'delete'] as const) {
  test(`remote ${remote} cannot overwrite or resurrect an open editor draft`, {timeout: 30_000}, async t => {
    const state = await fixture(t), [a, b] = state.pages;
    await create(a, 'Original'); await visibleRows(b, [[1, 'Original']]);
    await edit(a, 1, 'Retain this unsaved draft');
    if (remote === 'edit') {await edit(b, 1, 'Remote winner'); await save(b).click();}
    else await b.getByRole('button', {name: 'Delete annotation 1', exact: true}).click();
    const expected: [number, string][] = remote === 'edit' ? [[1, 'Remote winner']] : [];
    await visibleRows(a, expected);
    assert.equal(await note(a).inputValue(), 'Retain this unsaved draft');
    await save(a).click();
    await conflict(a, 'Retain this unsaved draft');
    assert.deepEqual(savedRows(state), expected);
    await reload(b); await visibleRows(b, expected);
  });
}

test('stale delete cannot remove a remotely edited row and keeps an unrelated capture draft', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  await create(a, 'Original'); await visibleRows(b, [[1, 'Original']]);
  await draft(a, 'Keep this separate draft');
  state.holdEvents(a);
  await edit(b, 1, 'Remote edit wins'); await save(b).click();
  await visibleRows(b, [[1, 'Remote edit wins']]);
  await a.getByRole('button', {name: 'Delete annotation 1', exact: true}).click();
  await conflict(a, 'Keep this separate draft');
  assert.deepEqual(savedRows(state), [[1, 'Remote edit wins']]);
  await state.releaseEvents(a);
  await visibleRows(a, [[1, 'Remote edit wins']]);
  assert.equal(await note(a).inputValue(), 'Keep this separate draft');
  await reload(b); await visibleRows(b, [[1, 'Remote edit wins']]);
});

test('stale Clear rejects instead of erasing a create not yet delivered to that tab', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  await create(a, 'Known'); await visibleRows(b, [[1, 'Known']]);
  state.holdEvents(a);
  await create(b, 'Unseen create');
  await visibleRows(a, [[1, 'Known']]);
  a.once('dialog', dialog => {void dialog.accept();});
  await a.getByRole('button', {name: 'Clear', exact: true}).click();
  await alert(a).waitFor({state: 'visible'});
  assert.match(await alert(a).innerText(), /not saved|changed/i);
  const expected: [number, string][] = [[1, 'Known'], [2, 'Unseen create']];
  assert.deepEqual(savedRows(state), expected);
  await state.releaseEvents(a);
  await Promise.all(state.pages.map(page => visibleRows(page, expected)));
  await reload(b); await visibleRows(b, expected);
});

for (const operation of ['create', 'update'] as const) {
  test(`failed ${operation} keeps draft and blocks writes through failed reload without blank overwrite`, {timeout: 30_000}, async t => {
    const state = await fixture(t), [a, b] = state.pages;
    await create(a, 'Saved original'); await visibleRows(b, [[1, 'Saved original']]);
    if (operation === 'update') await a.setViewportSize({width: 900, height: 600});
    if (operation === 'create') await draft(a, 'Unsaved retry');
    else await edit(a, 1, 'Unsaved retry');
    const before = structuredClone(state.snapshot());
    state.rejectWrite(); await save(a).click();
    await conflict(a, 'Unsaved retry');
    assert.deepEqual(state.snapshot(), before);
    await visibleRows(b, [[1, 'Saved original']]);
    assert.ok(await a.getByRole('button', {name: 'Clear', exact: true}).isDisabled());
    assert.ok(await a.getByRole('button', {name: 'Delete annotation 1', exact: true}).isDisabled());
    const count = state.writes.length;
    state.failReads(true);
    await a.getByRole('button', {name: 'Reload saved annotations', exact: true}).click();
    await a.waitForFunction(() => document.querySelector('[aria-label="Annotation storage"]')?.textContent?.includes('could not be loaded'));
    assert.equal(await note(a).inputValue(), 'Unsaved retry');
    assert.ok(await save(a).isDisabled());
    assert.equal(state.writes.length, count);
    assert.deepEqual(state.snapshot(), before);
    state.failReads(false);
    await a.getByRole('button', {name: 'Reload saved annotations', exact: true}).click();
    await a.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#bh-input button.s')?.disabled && document.querySelector('[aria-label="Annotation storage"]')?.textContent?.includes('reloaded'));
    assert.equal(await note(a).inputValue(), 'Unsaved retry');
    await save(a).click();
    const expected: [number, string][] = operation === 'create' ? [[1, 'Saved original'], [2, 'Unsaved retry']] : [[1, 'Unsaved retry']];
    await visibleRows(b, expected);
    assert.deepEqual(savedRows(state), expected);
    await reload(a); await visibleRows(a, expected);
  });
}

test('unrelated live edit preserves editor node and draft; destroy unsubscribes and fences queued events', {timeout: 30_000}, async t => {
  const state = await fixture(t), [a, b] = state.pages;
  await create(a, 'One'); await create(a, 'Two');
  await visibleRows(b, [[1, 'One'], [2, 'Two']]);
  await edit(a, 1, 'Local draft remains');
  const textarea = await note(a).elementHandle();
  assert.ok(textarea);
  await edit(b, 2, 'Remote second'); await save(b).click();
  await visibleRows(a, [[1, 'One'], [2, 'Remote second']]);
  assert.ok(await textarea.evaluate(node => node === document.querySelector('[aria-label="Annotation note"]')));
  assert.equal(await note(a).inputValue(), 'Local draft remains');
  await save(a).click();
  await visibleRows(b, [[1, 'Local draft remains'], [2, 'Remote second']]);
  state.holdEvents(a);
  await edit(b, 2, 'Late remote event'); await save(b).click();
  await visibleRows(b, [[1, 'Local draft remains'], [2, 'Late remote event']]);
  assert.equal(await a.evaluate(() => globalThis.__crossTabEvents.listeners.size), 1);
  await a.evaluate(() => globalThis.__piWebAnnotator?.destroy?.());
  assert.equal(await a.evaluate(() => globalThis.__crossTabEvents.listeners.size), 0);
  const writes = state.writes.length, calls = state.calls.length;
  // Deliver the already-captured callback too, not just the now-empty subscriber set.
  await state.releaseEvents(a, true);
  assert.equal(await a.locator('[data-bh-ui]').count(), 0);
  assert.equal(await a.evaluate(() => globalThis.__piWebAnnotator), undefined);
  assert.equal(state.writes.length, writes);
  assert.equal(state.calls.length, calls);
  await inject(a);
  await visibleRows(a, [[1, 'Local draft remains'], [2, 'Late remote event']]);
});
