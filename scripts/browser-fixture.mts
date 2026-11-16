import type { Page, Frame } from 'playwright';
import {readFile} from 'node:fs/promises';

const backgroundSource = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
type FixtureOptions = {externalStorageBroker?: boolean};

export function createBrowserFixture(): AnnotatorBrowser {
  globalThis.__requireFixtureValue = function required<T>(value: T): NonNullable<T> { if (value === undefined || value === null) throw new Error('Missing browser fixture value'); return value; };
  return {
    storage: {local: {async get() { return {}; }, async set() {}}, onChanged: {addListener() {}, removeListener() {}}},
    runtime: {async sendMessage() { return {ok: false}; }, getURL(path) { return `moz-extension://fixture/${path}`; }, onInstalled: {addListener() {}}, onMessage: {addListener() {}}},
    permissions: {async contains() {return false;}, async request() {return false;}},
    action: {onClicked: {addListener() {}}, setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {}},
    scripting: {async executeScript() {return [];}},
    tabs: {async create() {}, onUpdated: {addListener() {}}, onRemoved: {addListener() {}}},
    commands: {onCommand: {addListener() {}}},
  };
}

function prepareStorageFixture() {
  const api = globalThis.browser, memory: Record<string, unknown> = {};
  const listeners = new Set<(changes: StorageChanges, area: string) => void>();
  const get = api.storage.local.get.bind(api.storage.local), set = api.storage.local.set.bind(api.storage.local);
  api.storage.onChanged = {addListener(listener) {listeners.add(listener);}, removeListener(listener) {listeners.delete(listener);}};
  api.storage.local.get = async (key) => {
    const result = await get(key);
    return result[key] === undefined && key in memory ? {[key]: structuredClone(memory[key])} : result;
  };
  api.storage.local.set = async (update) => {
    await set(update);
    const changes: StorageChanges = {};
    for (const key of Object.keys(update)) {
      changes[key] = {oldValue: structuredClone(memory[key]), newValue: structuredClone(update[key])};
      memory[key] = structuredClone(update[key]);
    }
    for (const listener of listeners) listener(changes, 'local');
  };
  const send = api.runtime.sendMessage.bind(api.runtime);
  let broker: ((message: unknown, sender?: {url?: string}) => unknown) | undefined;
  api.runtime.onMessage = {addListener(listener) {broker = listener;}};
  api.runtime.sendMessage = async (message) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'pi-web-annotator-storage') {
      if (!broker) throw Error('Missing fixture storage broker');
      return broker(message, {url: location.href});
    }
    return send(message);
  };
}

function fixtureFunctionName<T extends object>(value: T, name: string): T {
  Object.defineProperty(value, 'name', {value: name, configurable: true});
  return value;
}
function fixtureScript(setup: () => void, options: FixtureOptions): string {
  const storage = options.externalStorageBroker ? '' : `(${prepareStorageFixture.toString()})(); (()=>{${backgroundSource}\n})();`;
  return `(() => {const __name = (${fixtureFunctionName.toString()}); const createBrowserFixture = (${createBrowserFixture.toString()}); (${setup.toString()})(); ${storage}})()`;
}

export async function addBrowserFixture(page: Page, setup: () => void, options: FixtureOptions = {}) {
  await page.addInitScript({content: fixtureScript(setup, options)});
}

export async function evaluateBrowserFixture(page: Page | Frame, setup: () => void, options: FixtureOptions = {}) {
  await page.evaluate(fixtureScript(setup, options));
}
