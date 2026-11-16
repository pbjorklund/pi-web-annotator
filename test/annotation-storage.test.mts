import {record} from '../pi-extension/contracts.ts';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const imported: unknown = require('../extension/annotation-storage.js');
const factory = record(imported).createAnnotationStorage;
const origin = 'https://synthetic.example';
const annotation: Annotation = {id: 1, type: 'element', selector: 'h1', tag: 'h1', pageKey: origin + '/', pageUrl: origin + '/', rect: {x: 0, y: 0, w: 10, h: 10}, note: 'Synthetic note', ts: 0, piStatus: 'pending'};
const collection: CollectionSnapshot = {schema: 2, revision: 1, nextId: 2, rows: [{revision: 1, annotation}]};

function fixture(initial: unknown = {ok: true, collection}) {
  if (typeof factory !== 'function') throw Error('Missing storage factory');
  let reply = initial, failure: Error | undefined;
  const requests: unknown[] = [], listeners = new Set<(changes: StorageChanges, area: string) => void>();
  const options: AnnotationStorageOptions & {pageStorage?: unknown} = {
    origin,
    extensionStorage: {async get() {throw Error('Client must use broker reads');}, async set() {throw Error('Client must not replace snapshots');}},
    runtime: {async sendMessage(message) {requests.push(structuredClone(message)); if (failure) throw failure; return structuredClone(reply);}},
    changes: {addListener(listener) {listeners.add(listener);}, removeListener(listener) {listeners.delete(listener);}},
    get pageStorage() {throw Error('Website storage must not be accessed');},
  };
  const value: unknown = Reflect.apply(factory, undefined, [options]), api = record(value);
  const {key, load, mutate, subscribe} = api;
  if (typeof key !== 'string' || typeof load !== 'function' || typeof mutate !== 'function' || typeof subscribe !== 'function') throw Error('Invalid generated client');
  return {
    key, requests, listeners,
    respond(value: unknown) {reply = value;},
    fail(error: Error) {failure = error;},
    removeChanges() {delete options.changes;},
    async load(): Promise<unknown> {const result: unknown = await load.call(api); return result;},
    async mutate(operation: CollectionOperation): Promise<unknown> {const result: unknown = await mutate.call(api, operation); return result;},
    subscribe(listener: (snapshot: CollectionSnapshot) => void, failed: (error: Error) => void) {
      const stop: unknown = subscribe.call(api, listener, failed);
      if (typeof stop !== 'function') throw Error('Missing unsubscribe');
      return () => {Reflect.apply(stop, undefined, []);};
    },
    emit(changes: StorageChanges, area = 'local') {for (const listener of listeners) listener(changes, area);},
  };
}

test('client loads only its origin through the broker without website or direct storage access', async () => {
  const client = fixture();
  assert.equal(client.key, 'pi-web-annotator:collection:v2:' + origin);
  assert.deepEqual(await client.load(), collection);
  assert.deepEqual(client.requests, [{type: 'pi-web-annotator-storage', origin, operation: {kind: 'load'}}]);
});

test('client sends explicit revisioned mutations rather than whole-array replacements', async () => {
  const client = fixture(), operation: CollectionOperation = {kind: 'update', id: 1, revision: 1, annotation: {...annotation, note: 'Synthetic edit'}};
  assert.deepEqual(await client.mutate(operation), {ok: true, collection});
  assert.deepEqual(client.requests, [{type: 'pi-web-annotator-storage', origin, operation}]);
});

test('client returns explicit conflict evidence without replaying the operation', async () => {
  const reply = {ok: false, reason: 'conflict', error: 'Changed in another tab', collection};
  const client = fixture(reply);
  assert.deepEqual(await client.mutate({kind: 'delete', id: 1, revision: 1}), reply);
  assert.equal(client.requests.length, 1);
});

test('subscription scopes local events to this origin and actually unsubscribes', () => {
  const client = fixture(), received: CollectionSnapshot[] = [], failures: Error[] = [];
  const stop = client.subscribe(value => received.push(value), error => failures.push(error));
  client.emit({other: {newValue: collection}});
  client.emit({[client.key]: {newValue: collection}}, 'sync');
  assert.deepEqual(received, []);
  client.emit({[client.key]: {newValue: collection}});
  assert.deepEqual(received, [collection]);
  stop();
  assert.equal(client.listeners.size, 0);
  client.emit({[client.key]: {newValue: collection}});
  assert.equal(received.length, 1);
  assert.deepEqual(failures, []);
});

test('migration intermediates are hidden and malformed/removal events report failure', () => {
  const client = fixture(), received: CollectionSnapshot[] = [], failures: Error[] = [];
  client.subscribe(value => received.push(value), error => failures.push(error));
  client.emit({[client.key]: {newValue: {...collection, migrationPending: true}}});
  assert.deepEqual(received, []);
  client.emit({[client.key]: {newValue: undefined}});
  client.emit({[client.key]: {newValue: {...collection, revision: -1}}});
  assert.equal(failures.length, 2);
  assert.deepEqual(received, []);
});

test('missing synchronization is an explicit error rather than a silent fallback', () => {
  const client = fixture(); client.removeChanges();
  assert.throws(() => client.subscribe(() => {}, () => {}), /synchronization is unavailable/);
});

test('invalid success/collection replies and invalid created IDs cannot acknowledge persistence', async () => {
  const client = fixture();
  for (const reply of [undefined, {ok: 'true', collection}, {ok: true}, {ok: true, collection: {...collection, nextId: 0}}, {ok: true, collection: {...collection, rows: [{revision: 2, annotation}]}}, {ok: true, collection, createdId: -1}]) {
    client.respond(reply);
    await assert.rejects(client.load(), /invalid|Invalid/);
  }
});

test('create acknowledgement requires the returned ID to exist in the confirmed collection', async () => {
  const client = fixture();
  await assert.rejects(client.mutate({kind: 'create', annotation}), /Invalid saved annotation ID/);
  client.respond({ok: true, collection, createdId: 99});
  await assert.rejects(client.mutate({kind: 'create', annotation}), /Invalid saved annotation ID/);
  assert.equal(client.requests.length, 2);
});

test('load/storage transport failures propagate without writes or automatic retry', async () => {
  const client = fixture({ok: false, reason: 'storage', error: 'Synthetic storage failure'});
  await assert.rejects(client.load(), /Synthetic storage failure/);
  client.fail(Error('Synthetic lost reply'));
  await assert.rejects(client.mutate({kind: 'clear', revision: 1}), /Synthetic lost reply/);
  assert.equal(client.requests.length, 2);
});
