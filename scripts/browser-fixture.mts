import type { Page, Frame } from 'playwright';

export function createBrowserFixture(): AnnotatorBrowser {
  globalThis.__requireFixtureValue = function required<T>(value: T): NonNullable<T> { if (value === undefined || value === null) throw new Error('Missing browser fixture value'); return value; };
  return {
    storage: {local: {async get() { return {}; }, async set() {}}},
    runtime: {async sendMessage() { return {ok: false}; }, getURL(path) { return `moz-extension://fixture/${path}`; }, onInstalled: {addListener() {}}, onMessage: {addListener() {}}},
    permissions: {async contains() {return false;}, async request() {return false;}},
    action: {onClicked: {addListener() {}}, setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {}},
    scripting: {async executeScript() {return [];}},
    tabs: {async create() {}, onUpdated: {addListener() {}}, onRemoved: {addListener() {}}},
    commands: {onCommand: {addListener() {}}},
  };
}

function fixtureFunctionName<T extends object>(value: T, name: string): T {
  Object.defineProperty(value, 'name', {value: name, configurable: true});
  return value;
}
function fixtureScript(setup: () => void): string {
  return `(() => {const __name = (${fixtureFunctionName.toString()}); const createBrowserFixture = (${createBrowserFixture.toString()}); (${setup.toString()})();})()`;
}

export async function addBrowserFixture(page: Page, setup: () => void) {
  await page.addInitScript({content: fixtureScript(setup)});
}

export async function evaluateBrowserFixture(page: Page | Frame, setup: () => void) {
  await page.evaluate(fixtureScript(setup));
}
