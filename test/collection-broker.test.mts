import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {createBrowserFixture} from '../scripts/browser-fixture.mts';
import {record} from '../pi-extension/contracts.ts';

// Transpile the owned source without touching generated browser artifacts.
const source = ts.transpileModule(await readFile(new URL('../src/browser/background.ts', import.meta.url), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
}).outputText;
const origin = 'https://synthetic.example';
const key = (site = origin) => `pi-web-annotator:collection:v2:${site}`;
const legacyKey = (site = origin) => `pi-web-annotator:collection:v1:${site}`;
function note(id = 99, text = 'Synthetic note'): Annotation {
  return {id, note: text, ts: 123, piStatus: 'pending', type: 'element', selector: '#synthetic', tag: 'BUTTON', pageKey: '/sample', pageUrl: origin + '/sample', rect: {x: 1, y: 2, w: 3, h: 4}, attrs: {'data-synthetic': 'yes'}, src: {fw: 'synthetic', file: 'sample.ts', line: 12}};
}
function deferred() {
  let release = () => {};
  const promise = new Promise<void>(resolve => {release = resolve;});
  return {promise, release};
}
function storage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  const writes: Record<string, unknown>[] = [];
  let failRead = false, failWrite = 0, writeCount = 0;
  let hold: {key: string; entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred>} | undefined;
  return {
    values, writes,
    set failRead(value: boolean) {failRead = value;},
    failWriteAt(index: number) {failWrite = writeCount + index;},
    holdNextWrite(site = origin) {
      const gate = {key: key(site), entered: deferred(), resume: deferred()};
      hold = gate;
      return gate;
    },
    async get(name: string) {
      if (failRead) throw Error('PRIVATE synthetic read exception');
      return structuredClone({[name]: values[name]});
    },
    async set(update: Record<string, unknown>) {
      writeCount++;
      const currentCount = writeCount;
      const gate = hold;
      if (gate && Object.hasOwn(update, gate.key)) {
        hold = undefined;
        gate.entered.release();
        await gate.resume.promise;
      }
      if (currentCount === failWrite) throw Error('PRIVATE synthetic write exception');
      writes.push(structuredClone(update));
      Object.assign(values, structuredClone(update));
    },
  };
}
function background(store = storage()) {
  let listener: (message: unknown, sender?: {url?: string}) => unknown = () => {throw Error('Missing runtime handler');};
  const fixture = createBrowserFixture();
  let fetches = 0;
  const browser: AnnotatorBrowser = {...fixture, storage: {local: store}, runtime: {...fixture.runtime, onMessage: {addListener(handler) {listener = handler;}}}};
  vm.runInNewContext(source, {browser, URL, AbortController, setTimeout, clearTimeout, fetch() {fetches++; throw Error('Unexpected bridge request');}});
  return {
    store,
    raw(message: unknown, sender?: {url?: string}) {return listener(message, sender);},
    async call(operation: unknown = {kind: 'load'}, site = origin, url = site + '/sample') {
      const reply: unknown = await listener({type: 'pi-web-annotator-storage', origin: site, operation}, {url});
      assert.equal(fetches, 0);
      return record(structuredClone(reply));
    },
  };
}
function collection(reply: Record<string, unknown>) {
  assert.equal(reply.ok, true);
  return record(reply.collection);
}
function rows(reply: Record<string, unknown>) {
  const value = collection(reply).rows;
  assert.ok(Array.isArray(value));
  const entries: unknown[] = value;
  return entries.map(row => ({revision: record(row).revision, annotation: record(record(row).annotation)}));
}
function conflict(reply: Record<string, unknown>) {
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'conflict');
  assert.match(String(reply.error), /Reload/);
  assert.ok(reply.collection);
}
function storageFailure(reply: Record<string, unknown>) {
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'storage');
  assert.match(String(reply.error), /confirmed/);
  assert.match(String(reply.error), /Reload/);
  assert.doesNotMatch(JSON.stringify(reply), /PRIVATE|Synthetic note/);
}

test('registered handler loads missing storage without writing and preserves synchronous unknown routing', async () => {
  const state = background();
  assert.equal(state.raw({type: 'unknown'}), undefined);
  assert.deepEqual(collection(await state.call()), {schema: 2, revision: 0, nextId: 1, rows: []});
  assert.deepEqual(state.store.writes, []);
});

test('interleaved creates with identical proposed IDs allocate sequential IDs from persisted state', async () => {
  const state = background();
  const gate = state.store.holdNextWrite();
  const first = state.call({kind: 'create', annotation: note(42, 'First')});
  await gate.entered.promise;
  const second = state.call({kind: 'create', annotation: note(42, 'Second')});
  const third = state.call({kind: 'create', annotation: note(42, 'Third')});
  gate.resume.release();
  assert.deepEqual((await Promise.all([first, second, third])).map(reply => reply.createdId), [1, 2, 3]);
  const loaded = await state.call();
  assert.deepEqual(rows(loaded).map(row => [row.annotation.id, row.annotation.note, row.revision]), [[1, 'First', 1], [2, 'Second', 2], [3, 'Third', 3]]);
  assert.equal(collection(loaded).nextId, 4);
});

test('disjoint edits and deletes retain all independently changed rows', async () => {
  const state = background();
  for (let id = 1; id <= 3; id++) await state.call({kind: 'create', annotation: note()});
  const gate = state.store.holdNextWrite();
  const edit = state.call({kind: 'update', id: 1, revision: 1, annotation: note(1, 'Edited')});
  await gate.entered.promise;
  const remove = state.call({kind: 'delete', id: 2, revision: 2});
  const otherEdit = state.call({kind: 'update', id: 3, revision: 3, annotation: note(3, 'Other edit')});
  gate.resume.release();
  for (const reply of await Promise.all([edit, remove, otherEdit])) assert.equal(reply.ok, true);
  assert.deepEqual(rows(await state.call()).map(row => [row.annotation.id, row.annotation.note, row.revision]), [[1, 'Edited', 4], [3, 'Other edit', 6]]);
});

for (const firstKind of ['update', 'delete']) {
  test(`first committed ${firstKind} wins against stale same-row edit/delete`, async () => {
    const state = background();
    await state.call({kind: 'create', annotation: note()});
    const edit = {kind: 'update', id: 1, revision: 1, annotation: note(1, 'Winner')};
    const remove = {kind: 'delete', id: 1, revision: 1};
    const gate = state.store.holdNextWrite();
    const first = state.call(firstKind === 'update' ? edit : remove);
    await gate.entered.promise;
    const second = state.call(firstKind === 'update' ? remove : edit);
    gate.resume.release();
    assert.equal((await first).ok, true);
    conflict(await second);
    const current = rows(await state.call());
    assert.equal(current.length, firstKind === 'update' ? 1 : 0);
    if (firstKind === 'update') assert.equal(current[0]?.annotation.note, 'Winner');
    conflict(await state.call(edit));
  });
}

test('stale Clear cannot erase unseen creates; clear/delete never reset nextId', async () => {
  const state = background();
  await state.call({kind: 'create', annotation: note()});
  await state.call({kind: 'create', annotation: note()});
  conflict(await state.call({kind: 'clear', revision: 1}));
  assert.equal(rows(await state.call()).length, 2);
  assert.equal(collection(await state.call({kind: 'clear', revision: 2})).nextId, 3);
  assert.equal((await state.call({kind: 'create', annotation: note()})).createdId, 3);
  await state.call({kind: 'delete', id: 3, revision: 4});
  assert.equal((await state.call({kind: 'create', annotation: note()})).createdId, 4);
});

test('failed write is sanitized and does not poison the origin queue', async () => {
  const state = background();
  state.store.failWriteAt(1);
  const [failed, recovered] = await Promise.all([state.call({kind: 'create', annotation: note()}), state.call({kind: 'create', annotation: note(99, 'Recovered')})]);
  storageFailure(failed);
  assert.equal(recovered.createdId, 1);
  assert.deepEqual(rows(await state.call()).map(row => row.annotation.note), ['Recovered']);
});

test('held operation does not block another origin and every operation rereads persisted state', async () => {
  const state = background();
  const gate = state.store.holdNextWrite();
  const waiting = state.call({kind: 'create', annotation: note()});
  await gate.entered.promise;
  const other = await state.call({kind: 'create', annotation: note()}, 'https://other.synthetic');
  assert.equal(other.createdId, 1);
  gate.resume.release();
  await waiting;
  state.store.values[key()] = {schema: 2, revision: 10, nextId: 20, rows: []};
  assert.equal((await state.call({kind: 'create', annotation: note()})).createdId, 20);
  assert.equal(rows(await state.call(undefined, 'https://other.synthetic')).length, 1);
});

test('read failures and corrupt saved data do not overwrite data or import legacy', async () => {
  const state = background();
  state.store.failRead = true;
  storageFailure(await state.call());
  state.store.failRead = false;
  for (const corrupt of [null, [], {schema: 2, revision: 0, nextId: 1, rows: [{revision: 1, annotation: note(1)}]}, {schema: 2, revision: 2, nextId: 2, rows: [{revision: 1, annotation: note(1)}, {revision: 2, annotation: note(1)}]}]) {
    state.store.values[key()] = corrupt;
    state.store.values[legacyKey()] = [note()];
    storageFailure(await state.call({kind: 'create', annotation: note()}));
    assert.deepEqual(state.store.values[key()], corrupt);
  }
  assert.equal(state.store.writes.length, 0);
});

test('restart preserves revisions and ID allocation without deleted-note history', async () => {
  const store = storage();
  const first = background(store);
  await first.call({kind: 'create', annotation: note(99, 'Deleted secret synthetic')});
  await first.call({kind: 'delete', id: 1, revision: 1});
  const restarted = background(store);
  assert.equal(collection(await restarted.call()).revision, 2);
  assert.equal((await restarted.call({kind: 'create', annotation: note()})).createdId, 2);
  assert.doesNotMatch(JSON.stringify(store.values), /Deleted secret synthetic/);
  conflict(await restarted.call({kind: 'update', id: 1, revision: 1, annotation: note(1)}));
});

test('legacy migration preserves context and valid IDs, repairs duplicates deterministically, then erases v1', async () => {
  const legacy = [note(5), note(5, 'Duplicate'), note(1), {...note(), id: -1}, {...note(), id: 0}];
  const store = storage({[legacyKey()]: legacy});
  const state = background(store);
  const loaded = await state.call();
  assert.deepEqual(rows(loaded).map(row => row.annotation.id), [5, 2, 1, 3, 4]);
  assert.deepEqual(rows(loaded)[0]?.annotation, legacy[0]);
  assert.equal(collection(loaded).nextId, 6);
  assert.equal(collection(loaded).revision, 1);
  assert.deepEqual(store.values[legacyKey()], []);
  assert.equal(record(store.writes[0]?.[key()]).migrationPending, true);
  assert.deepEqual(store.writes[1], {[legacyKey()]: []});
  assert.equal(Object.hasOwn(record(store.values[key()]), 'migrationPending'), false);
  store.values[legacyKey()] = [note(100, 'Old writer')];
  assert.equal(rows(await background(store).call()).length, 5);
});

for (const step of [1, 2, 3]) {
  test(`migration write failure at phase ${step} retries before mutations, including restart`, async () => {
    const original = [note(7)];
    const store = storage({[legacyKey()]: original});
    store.failWriteAt(step);
    storageFailure(await background(store).call({kind: 'create', annotation: note()}));
    if (step <= 2) assert.deepEqual(store.values[legacyKey()], original);
    if (step > 1) assert.equal(record(store.values[key()]).migrationPending, true);
    const restarted = background(store);
    const created = await restarted.call({kind: 'create', annotation: note(99, 'After retry')});
    assert.equal(created.createdId, 8);
    assert.deepEqual(rows(created).map(row => row.annotation.note), ['Synthetic note', 'After retry']);
    assert.deepEqual(store.values[legacyKey()], []);
    assert.equal(Object.hasOwn(record(store.values[key()]), 'migrationPending'), false);
  });
}

test('created text notes use allocated mark IDs rather than tab-local proposed IDs', async () => {
  const state = background();
  const textNote = {...note(88), type: 'text', text: 'Synthetic selection', markSelector: "mark[data-bh-anno-id='88']"};
  const replies = await Promise.all([state.call({kind: 'create', annotation: textNote}), state.call({kind: 'create', annotation: textNote})]);
  assert.deepEqual(replies.map(reply => reply.createdId), [1, 2]);
  assert.deepEqual(rows(await state.call()).map(row => row.annotation.markSelector), ["mark[data-bh-anno-id='1']", "mark[data-bh-anno-id='2']"]);
});

test('legacy text mark selectors follow repaired IDs while valid annotation context survives', async () => {
  const textNote = {...note(8), type: 'text', text: 'Synthetic selection', markSelector: "mark[data-bh-anno-id='8']"};
  const store = storage({[legacyKey()]: [textNote, {...textNote}, {...textNote, id: -5}]});
  const loaded = await background(store).call();
  assert.deepEqual(rows(loaded).map(row => [row.annotation.id, row.annotation.markSelector, row.annotation.text]), [
    [8, "mark[data-bh-anno-id='8']", 'Synthetic selection'],
    [1, "mark[data-bh-anno-id='1']", 'Synthetic selection'],
    [2, "mark[data-bh-anno-id='2']", 'Synthetic selection'],
  ]);
});

test('grouped row updates commit one atomic snapshot and one revision', async () => {
  const state = background();
  await state.call({kind: 'create', annotation: note()});
  await state.call({kind: 'create', annotation: note()});
  const before = state.store.writes.length;
  const reply = await state.call({kind: 'updateMany', updates: [
    {id: 1, revision: 1, annotation: {...note(1), piStatus: 'sending', piJobId: 'synthetic-job'}},
    {id: 2, revision: 2, annotation: {...note(2), piStatus: 'sending', piJobId: 'synthetic-job'}},
  ]});
  assert.equal(state.store.writes.length, before + 1);
  assert.equal(collection(reply).revision, 3);
  assert.deepEqual(rows(reply).map(row => [row.revision, row.annotation.piStatus, row.annotation.piJobId]), [[3, 'sending', 'synthetic-job'], [3, 'sending', 'synthetic-job']]);
});

test('one stale or deleted row rejects a whole grouped update without partial persistence', async () => {
  const state = background();
  await state.call({kind: 'create', annotation: note()});
  await state.call({kind: 'create', annotation: note()});
  await state.call({kind: 'update', id: 2, revision: 2, annotation: note(2, 'Concurrent edit')});
  const before = state.store.writes.length;
  const batch = {kind: 'updateMany', updates: [
    {id: 1, revision: 1, annotation: {...note(1), piStatus: 'sent'}},
    {id: 2, revision: 2, annotation: {...note(2), piStatus: 'sent'}},
  ]};
  conflict(await state.call(batch));
  assert.equal(state.store.writes.length, before);
  assert.deepEqual(rows(await state.call()).map(row => [row.annotation.note, row.annotation.piStatus]), [['Synthetic note', 'pending'], ['Concurrent edit', 'pending']]);
  await state.call({kind: 'delete', id: 2, revision: 3});
  conflict(await state.call(batch));
  assert.deepEqual(rows(await state.call()).map(row => row.annotation.piStatus), ['pending']);
});

test('grouped updates reject duplicate IDs and malformed members before storage writes', async () => {
  const state = background();
  await state.call({kind: 'create', annotation: note()});
  const update = {id: 1, revision: 1, annotation: note(1, 'New value')};
  const before = state.store.writes.length;
  for (const updates of [[update, update], [update, {...update, revision: 0}], [update, {...update, id: 2}], []]) {
    assert.equal((await state.call({kind: 'updateMany', updates})).reason, 'invalid');
  }
  assert.equal(state.store.writes.length, before);
  assert.equal(rows(await state.call())[0]?.annotation.note, 'Synthetic note');
});

test('minimal supported legacy notes receive the old UI defaults and verified sender page identity', async () => {
  const legacy = [{id: 4, note: 'Minimal synthetic note', selector: '#minimal'}];
  const state = background(storage({[legacyKey()]: legacy}));
  const url = origin + '/first/path?synthetic=1#selection';
  const first = state.call({kind: 'load'}, origin, url);
  const second = state.call({kind: 'load'}, origin, origin + '/second');
  const expected = {id: 4, note: 'Minimal synthetic note', selector: '#minimal', tag: '', type: 'element',
    pageKey: url, pageUrl: url, rect: {x: 0, y: 0, w: 0, h: 0}, ts: 0, piStatus: 'pending'};
  assert.deepEqual(rows(await first)[0]?.annotation, expected);
  assert.deepEqual(rows(await second)[0]?.annotation, expected);
  assert.equal(rows(await background(state.store).call())[0]?.annotation.pageUrl, url);
});

test('legacy normalization preserves every supported valid context field', async () => {
  const full = {...note(6), type: 'text', pageKey: 'saved-key', pageUrl: 'https://saved.synthetic/path', preview: 'Preview', text: 'Selection', textTruncated: true,
    context: 'Context', markSelector: "mark[data-bh-anno-id='6']", elId: 'element', cls: 'synthetic', html: '<button>', label: 'Label', ord: '1/2', color: 'red', bg: 'white',
    styles: {display: 'block'}, piStatus: 'in_progress', piJobId: 'synthetic-job', piSendingAt: 120};
  const state = background(storage({[legacyKey()]: [full]}));
  assert.deepEqual(rows(await state.call())[0]?.annotation, full);
});

test('legacy-only normalization defaults malformed optional metadata and filters context like the old UI', async () => {
  const legacy = {id: -3.5, note: 'Optional metadata', selector: '#optional', type: 'unknown', tag: 123, rect: {x: 1, y: 2, w: 'bad', h: 4},
    pageKey: '', pageUrl: 42, ts: Infinity, piStatus: 'unknown', preview: 123, text: 'Keep text', context: null, textTruncated: 'bad', piSendingAt: NaN,
    attrs: {keep: 'attribute', discard: 42}, styles: {display: 'block', bad: false}, src: {fw: 'synthetic', file: 42, line: Infinity, comp: 'Component', unknown: 'discard'}, unknown: 'discard'};
  const state = background(storage({[legacyKey()]: [legacy]}));
  const url = origin + '/fallback?x=1#hash';
  const loaded = await state.call({kind: 'load'}, origin, url);
  assert.deepEqual(rows(loaded)[0]?.annotation, {id: 1, note: 'Optional metadata', selector: '#optional', tag: '', type: 'element', rect: {x: 0, y: 0, w: 0, h: 0},
    pageKey: url, pageUrl: url, ts: 0, piStatus: 'pending', text: 'Keep text', attrs: {keep: 'attribute'}, styles: {display: 'block'}, src: {fw: 'synthetic', comp: 'Component'}});
  assert.equal(rows(await state.call())[0]?.annotation.id, 1);
  assert.equal((await background().call({kind: 'create', annotation: legacy})).reason, 'invalid');
});

test('opaque legacy fallback distinguishes pageKey origin from pageUrl href', async () => {
  const store = storage({[legacyKey('null')]: [{id: 1, note: 'Opaque synthetic', selector: '#opaque'}]});
  const loaded = rows(await background(store).call({kind: 'load'}, 'null', 'file:///synthetic/path?query=1#hash'))[0]?.annotation;
  assert.equal(loaded?.pageKey, 'null/synthetic/path?query=1#hash');
  assert.equal(loaded?.pageUrl, 'file:///synthetic/path?query=1#hash');
});

test('malformed legacy records fail rather than silently drop annotations', async () => {
  for (const malformed of [null, [], 'invalid', {}, {id: 1, note: 'Missing selector'}, {id: 1, selector: '#missing-note'}, {id: 'bad', note: 'Bad id', selector: '#id'},
    {id: NaN, note: 'NaN id', selector: '#id'}, {id: Infinity, note: 'Infinite id', selector: '#id'}, {id: 1, note: 42, selector: '#note'}, {id: 1, note: 'Bad selector', selector: 42}]) {
    const legacy = [note(), malformed];
    const store = storage({[legacyKey()]: legacy});
    storageFailure(await background(store).call());
    assert.deepEqual(store.values[legacyKey()], legacy);
    assert.equal(store.writes.length, 0);
  }
  for (const legacy of ['invalid']) {
    const store = storage({[legacyKey()]: legacy});
    storageFailure(await background(store).call());
    assert.deepEqual(store.values[legacyKey()], legacy);
    assert.equal(store.writes.length, 0);
  }
});

test('sender authorization rejects missing/malformed/mismatched origins but allows legitimate opaque origin', async () => {
  const state = background();
  for (const sender of [undefined, {}, {url: 'not a URL'}, {url: 'https://other.synthetic/page'}]) {
    const result: unknown = await state.raw({type: 'pi-web-annotator-storage', origin, operation: {kind: 'load'}}, sender);
    assert.equal(record(result).reason, 'invalid');
  }
  assert.equal((await state.call({kind: 'load'}, 'https://synthetic.example/')).reason, 'invalid');
  assert.equal((await state.call({kind: 'load'}, 'null', 'file:///synthetic')).ok, true);
  assert.equal((await state.call({kind: 'load'}, 'null', 'data:text/plain,synthetic')).ok, true);
  for (const operation of [null, {kind: 'update', id: 1, revision: 1, annotation: note(2)}, {kind: 'delete', id: -1, revision: 1}, {kind: 'clear', revision: NaN}, {kind: 'create', annotation: {...note(), rect: {x: 'bad'}}}, {kind: 'create', annotation: {...note(), piStatus: 'invalid'}}]) {
    assert.equal((await state.call(operation)).reason, 'invalid');
  }
  assert.equal(state.store.writes.length, 0);
});
