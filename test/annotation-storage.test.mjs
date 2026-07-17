import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createAnnotationStorage } = require('../extension/annotation-storage.js');

function fakeExtensionStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
  };
}

function fakePageStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    getItem(key) { return values[key] ?? null; },
    removeItem(key) { delete values[key]; },
  };
}

test('stores each site collection in extension-owned storage', async () => {
  const extensionStorage = fakeExtensionStorage();
  const pageStorage = fakePageStorage();
  const storage = createAnnotationStorage({
    extensionStorage,
    pageStorage,
    origin: 'https://example.com',
    pathname: '/review',
    hash: '',
  });

  await storage.save([{ id: 1, note: 'Change this' }]);

  assert.deepEqual(extensionStorage.values[storage.key], [{ id: 1, note: 'Change this' }]);
  assert.deepEqual(pageStorage.values, {});
  assert.match(storage.key, /^pi-web-annotator:collection:v1:/);
});

test('loads an existing extension-owned collection', async () => {
  const key = 'pi-web-annotator:collection:v1:https://example.com';
  const extensionStorage = fakeExtensionStorage({ [key]: [{ id: 2 }] });
  const storage = createAnnotationStorage({
    extensionStorage,
    pageStorage: fakePageStorage(),
    origin: 'https://example.com',
    pathname: '/',
    hash: '',
  });

  const items = await storage.load((item) => ({ ...item, normalized: true }));

  assert.deepEqual(items, [{ id: 2, normalized: true }]);
});

test('migrates the latest page-storage collection before removing it', async () => {
  const extensionStorage = fakeExtensionStorage();
  const pageStorage = fakePageStorage({
    'browser-annotations:collection:v1': JSON.stringify([{ id: 3 }]),
  });
  const storage = createAnnotationStorage({
    extensionStorage,
    pageStorage,
    origin: 'https://example.com',
    pathname: '/',
    hash: '',
  });

  const items = await storage.load((item) => item);

  assert.deepEqual(items, [{ id: 3 }]);
  assert.deepEqual(extensionStorage.values[storage.key], [{ id: 3 }]);
  assert.equal(pageStorage.getItem('browser-annotations:collection:v1'), null);
});

test('preserves legacy page data when extension storage fails', async () => {
  const pageStorage = fakePageStorage({
    'bh-anno:collection:v1': JSON.stringify([{ id: 4 }]),
  });
  const storage = createAnnotationStorage({
    extensionStorage: {
      async get() { return {}; },
      async set() { throw new Error('storage unavailable'); },
    },
    pageStorage,
    origin: 'https://example.com',
    pathname: '/',
    hash: '',
  });

  await assert.rejects(storage.load((item) => item), /storage unavailable/);
  assert.notEqual(pageStorage.getItem('bh-anno:collection:v1'), null);
});
