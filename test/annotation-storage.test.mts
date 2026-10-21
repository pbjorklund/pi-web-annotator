import {record} from '../pi-extension/contracts.ts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const imported: unknown = require('../extension/annotation-storage.js');
const create = record(imported).createAnnotationStorage;
if (typeof create !== 'function') throw new Error('Missing storage factory');
const createAnnotationStorage = (options: AnnotationStorageOptions & {pageStorage?: unknown}) => {
  const value: unknown = Reflect.apply(create, undefined, [options]), storage = record(value);
  const {key, load, save} = storage;
  if (typeof key !== 'string' || typeof load !== 'function' || typeof save !== 'function') throw new Error('Invalid generated storage API');
  return {key, async load(normalize: (value: unknown) => unknown): Promise<unknown> { const value: unknown = await load.call(storage, normalize); return value; },
    async save(items: unknown[]) { await save.call(storage, items); }};
};

function fakeExtensionStorage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key: string) { return { [key]: values[key] }; },
    async set(update: Record<string, unknown>) { Object.assign(values, update); },
  };
}

test('stores each site collection in extension-owned storage', async () => {
  const extensionStorage = fakeExtensionStorage();
  const storage = createAnnotationStorage({
    extensionStorage,
    origin: 'https://example.com',
  });

  await storage.save([{ id: 1, note: 'Change this' }]);

  assert.deepEqual(extensionStorage.values[storage.key], [{ id: 1, note: 'Change this' }]);
  assert.match(storage.key, /^pi-web-annotator:collection:v1:/);
});

test('loads an existing extension-owned collection', async () => {
  const key = 'pi-web-annotator:collection:v1:https://example.com';
  const extensionStorage = fakeExtensionStorage({ [key]: [{ id: 2 }] });
  const storage = createAnnotationStorage({
    extensionStorage,
    origin: 'https://example.com',
  });

  const items = await storage.load((item) => ({ ...record(item), normalized: true }));

  assert.deepEqual(items, [{ id: 2, normalized: true }]);
});

test('loads an empty collection without reading page storage or writing data', async () => {
  const extensionStorage = fakeExtensionStorage();
  const storage = createAnnotationStorage({
    extensionStorage,
    origin: 'https://example.com',
    get pageStorage() { throw new Error('Page storage must not be accessed'); },
  });

  assert.deepEqual(await storage.load((item) => item), []);
  assert.deepEqual(extensionStorage.values, {});
});
