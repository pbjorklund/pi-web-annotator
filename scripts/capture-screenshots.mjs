// Generated from scripts/capture-screenshots.mts; run npm run build:typescript. Do not edit.
import { createBrowserFixture, addBrowserFixture } from './browser-fixture.mjs';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startDemoServer } from './serve-demo.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'artwork/screenshots');
const configuredBrowser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const systemBrowser = [configuredBrowser, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    .find((path) => path && existsSync(path));
await mkdir(outputDirectory, { recursive: true });
const demo = await startDemoServer(0);
let browser;
try {
    browser = await chromium.launch({
        headless: process.env.DEMO_HEADLESS !== '0',
        ...(systemBrowser ? { executablePath: systemBrowser } : {}),
    });
    const context = await browser.newContext({
        colorScheme: 'light',
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        viewport: { width: 1440, height: 960 },
    });
    const page = await context.newPage();
    await addBrowserFixture(page, () => {
        const storage = {};
        const jobs = {};
        globalThis.browser = { ...createBrowserFixture(),
            storage: {
                local: {
                    async get(key) {
                        return typeof key === 'string' && key in storage ? { [key]: storage[key] } : {};
                    },
                    async set(values) {
                        Object.assign(storage, values);
                    },
                },
            },
            runtime: { ...createBrowserFixture().runtime,
                async sendMessage(message) {
                    if (!message || typeof message !== 'object' || !('type' in message))
                        return { ok: false };
                    if (message.type === 'pi-web-annotator-health')
                        return { ok: true };
                    if (message.type === 'pi-web-annotator-consent')
                        return { granted: true };
                    if (message.type === 'pi-web-annotator-send' && 'job' in message && message.job && typeof message.job === 'object' && 'id' in message.job && typeof message.job.id === 'string') {
                        jobs[message.job.id] = Date.now();
                        return { ok: true, status: 'sent' };
                    }
                    if (message.type === 'pi-web-annotator-status' && 'jobIds' in message && Array.isArray(message.jobIds)) {
                        const states = {};
                        const ids = message.jobIds;
                        for (const id of ids) {
                            if (typeof id !== 'string')
                                continue;
                            const age = Date.now() - jobs[id];
                            states[id] = age >= 1800 ? 'completed' : age >= 650 ? 'in_progress' : 'sent';
                        }
                        return { ok: true, jobs: states };
                    }
                    return { ok: false };
                },
            },
        };
    });
    await page.goto(demo.origin, { waitUntil: 'networkidle' });
    await page.addScriptTag({ path: resolve(root, 'extension/annotation-storage.js') });
    await page.addScriptTag({ path: resolve(root, 'extension/web-annotator.js') });
    await page.waitForFunction(() => globalThis.__piWebAnnotator?.ready === true);
    await page.locator('[aria-label="Pi connected"]').waitFor();
    const screenshot = (name) => page.screenshot({
        animations: 'disabled',
        path: resolve(outputDirectory, name),
    });
    await page.locator('#release-title').click({ position: { x: 280, y: 58 } });
    await page.getByRole('textbox', { name: 'Annotation note' }).fill('Shorten this heading and keep the direct tone.');
    await screenshot('annotation-editor.png');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#bh-list .it').waitFor();
    await screenshot('annotation-panel.png');
    await page.getByRole('button', { name: 'Element', exact: true }).click();
    await page.locator('#release-summary').evaluate((element) => {
        const sentence = "Two small decisions still block Friday's launch.";
        const textNode = element.firstChild;
        if (!textNode || textNode.textContent === null)
            throw new Error('Missing fixture text');
        const start = textNode.textContent.indexOf(sentence);
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + sentence.length);
        const selection = window.getSelection();
        if (!selection)
            throw new Error('Missing fixture selection');
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('textbox', { name: 'Annotation note' }).waitFor();
    await page.locator('#bh-input').evaluate((element) => {
        element.style.left = '600px';
        element.style.top = '390px';
    });
    await page.getByRole('textbox', { name: 'Annotation note' }).fill('Make this deadline easier to scan.');
    await screenshot('text-annotation.png');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Send to Pi', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#bh-list input.state-check:checked').length === 2, null, { timeout: 8000 });
    await screenshot('pi-workflow.png');
    await context.close();
    console.log(`Wrote demo screenshots to ${outputDirectory}`);
}
finally {
    if (browser)
        await browser.close();
    await demo.close();
}
