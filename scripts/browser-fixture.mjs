// Generated from scripts/browser-fixture.mts; run npm run build:typescript. Do not edit.
export function createBrowserFixture() {
    globalThis.__requireFixtureValue = function required(value) { if (value === undefined || value === null)
        throw new Error('Missing browser fixture value'); return value; };
    return {
        storage: { local: { async get() { return {}; }, async set() { } } },
        runtime: { async sendMessage() { return { ok: false }; }, getURL(path) { return `moz-extension://fixture/${path}`; }, onInstalled: { addListener() { } }, onMessage: { addListener() { } } },
        permissions: { async contains() { return false; }, async request() { return false; } },
        action: { onClicked: { addListener() { } }, setBadgeText() { }, setBadgeBackgroundColor() { }, setTitle() { } },
        scripting: { async executeScript() { return []; } },
        tabs: { async create() { }, onUpdated: { addListener() { } }, onRemoved: { addListener() { } } },
        commands: { onCommand: { addListener() { } } },
    };
}
function fixtureFunctionName(value, name) {
    Object.defineProperty(value, 'name', { value: name, configurable: true });
    return value;
}
function fixtureScript(setup) {
    return `(() => {const __name = (${fixtureFunctionName.toString()}); const createBrowserFixture = (${createBrowserFixture.toString()}); (${setup.toString()})();})()`;
}
export async function addBrowserFixture(page, setup) {
    await page.addInitScript({ content: fixtureScript(setup) });
}
export async function evaluateBrowserFixture(page, setup) {
    await page.evaluate(fixtureScript(setup));
}
