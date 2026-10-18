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

  const items = await storage.load((item) => ({ ...item, normalized: true }));

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
