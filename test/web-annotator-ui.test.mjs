import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { firefox } from 'playwright';
import { startDemoServer } from '../scripts/serve-demo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function injectAnnotator(page) {
  await page.addScriptTag({ path: resolve(root, 'extension/annotation-storage.js') });
  await page.addScriptTag({ path: resolve(root, 'extension/web-annotator.js') });
  await page.waitForFunction(() => globalThis.__piWebAnnotator?.ready === true);
}

function assertInsideViewport(box, viewport) {
  assert.ok(box.x >= 7, `expected panel x ${box.x} to stay inside the viewport`);
  assert.ok(box.y >= 7, `expected panel y ${box.y} to stay inside the viewport`);
  assert.ok(box.x + box.width <= viewport.width - 7, 'expected panel right edge to stay inside the viewport');
  assert.ok(box.y + box.height <= viewport.height - 7, 'expected panel bottom edge to stay inside the viewport');
}

test('moves, clamps, resets, and restores the annotation panel', { timeout: 30_000 }, async (t) => {
  const demo = await startDemoServer(0);
  const browser = await firefox.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await demo.close();
  });

  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 900, height: 600 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const prefix = '__pi_web_annotator_ui_test__';
    globalThis.browser = {
      storage: {
        local: {
          async get(key) {
            const raw = localStorage.getItem(prefix + key);
            return raw === null ? {} : { [key]: JSON.parse(raw) };
          },
          async set(values) {
            for (const [key, value] of Object.entries(values)) {
              localStorage.setItem(prefix + key, JSON.stringify(value));
            }
          },
        },
      },
      runtime: {
        async sendMessage() { return { ok: false }; },
      },
    };
  });

  await page.goto(demo.origin, { waitUntil: 'networkidle' });
  await injectAnnotator(page);

  const panel = page.locator('#bh-panel');
  const header = page.locator('#bh-panel .h');
  const moveControl = page.getByRole('button', { name: /move annotation panel/i });
  const initial = await panel.boundingBox();
  assert.ok(initial.x > 300, 'panel should start docked on the right');
  assert.match(await moveControl.getAttribute('aria-label'), /^Annotations 0\b/);

  const title = await page.locator('#bh-panel .ttl').boundingBox();
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(12, 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left <= 10 && rect.top <= 10;
  });

  const dragged = await panel.boundingBox();
  assert.ok(dragged.x <= 10, `expected drag to clamp near the left edge, got ${dragged.x}`);
  assert.ok(dragged.y <= 10, `expected drag to clamp near the top edge, got ${dragged.y}`);

  const beforeButton = await panel.boundingBox();
  await page.getByRole('button', { name: 'Element', exact: true }).click();
  const afterButton = await panel.boundingBox();
  assert.equal(afterButton.x, beforeButton.x, 'using a header button must not move the panel horizontally');
  assert.equal(afterButton.y, beforeButton.y, 'using a header button must not move the panel vertically');

  await moveControl.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left > 300 && rect.top > 200;
  });
  const dockedBottomRight = await panel.boundingBox();
  assert.ok(dockedBottomRight.x > 300, 'ArrowRight should dock the panel on the right');
  assert.ok(dockedBottomRight.y > 200, 'ArrowDown should dock the panel at the bottom');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left <= 10 && rect.top <= 10;
  });
  const dockedTopLeft = await panel.boundingBox();
  assert.ok(dockedTopLeft.x <= 10 && dockedTopLeft.y <= 10, 'arrow keys should dock the panel at the top-left');

  await page.keyboard.press('Home');
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left > 300 && rect.top > 200;
  });
  const reset = await panel.boundingBox();
  assert.ok(reset.x > 300 && reset.y > 200, 'Home should reset the panel to bottom-right');

  await page.evaluate(() => {
    document.querySelector('#bh-panel .h').addEventListener('pointerdown', (event) => {
      globalThis.__testPanelPointerId = event.pointerId;
    }, { once: true });
  });
  const cancelTitle = await page.locator('#bh-panel .ttl').boundingBox();
  await page.mouse.move(cancelTitle.x + cancelTitle.width / 2, cancelTitle.y + cancelTitle.height / 2);
  await page.mouse.down();
  await page.mouse.move(100, 100, { steps: 2 });
  await page.evaluate(() => {
    document.querySelector('#bh-panel .h').dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: globalThis.__testPanelPointerId,
    }));
  });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left > 300 && rect.top > 200;
  });

  await moveControl.click();
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.left <= 10 && rect.top > 200;
  });
  await moveControl.focus();
  await page.keyboard.press('Home');

  await moveControl.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => localStorage.length > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await injectAnnotator(page);
  const restored = await page.locator('#bh-panel').boundingBox();
  assert.ok(restored.x <= 10 && restored.y <= 10, 'saved panel placement should survive reinjection');

  const viewport = { width: 420, height: 300 };
  await page.setViewportSize(viewport);
  await page.waitForFunction(() => {
    const rect = document.querySelector('#bh-panel').getBoundingClientRect();
    return rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7;
  });
  assertInsideViewport(await page.locator('#bh-panel').boundingBox(), viewport);

  assert.ok(await header.isVisible());
  await context.close();
});
