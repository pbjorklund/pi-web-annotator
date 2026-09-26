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

test('opens and cancels element and text capture editors without saving or leaving a mark', { timeout: 30_000 }, async (t) => {
  const demo = await startDemoServer(0);
  const browser = await firefox.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await demo.close();
  });
  const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(5_000);
  await page.addInitScript(() => {
    globalThis.browser = {
      storage: { local: { async get() { return {}; }, async set() {} } },
      runtime: { async sendMessage() { return { ok: false }; } },
    };
  });
  await page.goto(demo.origin, { waitUntil: 'networkidle' });
  await injectAnnotator(page);

  const captureButton = page.getByRole('button', { name: 'Publish release' });
  const captureBox = await captureButton.boundingBox();
  await captureButton.click();
  const elementDialog = page.getByRole('dialog', { name: 'Add annotation' });
  assert.ok(await elementDialog.isVisible());
  assert.equal(await page.getByLabel('Annotation note').getAttribute('placeholder'), 'Note for this element…');
  assert.equal(await page.getByLabel('Annotation note').inputValue(), '');
  assert.match(await elementDialog.locator('.bh-primary').innerText(), /find by:/);
  assert.match(await elementDialog.locator('.bh-fallback').innerText(), /dom-path fallback:/);
  const elementBox = await elementDialog.boundingBox();
  assertInsideViewport(elementBox, { width: 900, height: 600 });
  assert.ok(Math.abs(elementBox.x - Math.max(8, Math.min(captureBox.x + captureBox.width / 2, 900 - elementBox.width - 8))) < 2);
  assert.ok(Math.abs(elementBox.y - Math.max(8, Math.min(captureBox.y + captureBox.height / 2, 600 - elementBox.height - 8))) < 2);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Annotation note');
  await page.keyboard.press('Escape');
  assert.ok(await elementDialog.isHidden());
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator.items.length), 0);

  await page.getByRole('button', { name: 'Element', exact: true }).click();
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Publish release');
    const range = document.createRange();
    range.selectNodeContents(target.firstChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const textDialog = page.getByRole('dialog', { name: 'Add annotation' });
  await textDialog.waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('Annotation note').getAttribute('placeholder'), 'Note for this text…');
  assert.equal(await page.getByLabel('Annotation note').inputValue(), '');
  assert.match(await textDialog.locator('.bh-primary').innerText(), /find by:/);
  assert.match(await textDialog.locator('.bh-fallback').innerText(), /Text: "Publish release"/);
  const textBox = await textDialog.boundingBox();
  assertInsideViewport(textBox, { width: 900, height: 600 });
  // This selection's range collapses when wrapped; its existing position is clamped to the margin.
  assert.equal(textBox.x, 8);
  assert.equal(textBox.y, 8);
  assert.equal(await page.locator('mark[data-bh-anno-id]').count(), 1);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Annotation note');
  await page.keyboard.press('Escape');
  assert.ok(await textDialog.isHidden());
  assert.equal(await page.locator('mark[data-bh-anno-id]').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator.items.length), 0);

  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Publish release');
    target.normalize();
    const range = document.createRange();
    range.setStart(target.firstChild, 0);
    range.setEnd(target.firstChild, 7);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await textDialog.waitFor({ state: 'visible' });
  await page.getByLabel('Annotation note').fill('Shorten the release label.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => {
    const item = globalThis.__piWebAnnotator.items[0];
    return { id: item.id, type: item.type, text: item.text, note: item.note };
  }), { id: 1, type: 'text', text: 'Publish', note: 'Shorten the release label.' });
  assert.equal(await page.locator('mark[data-bh-anno-id="1"]').count(), 1);
});

test('edits and persists a saved annotation note', { timeout: 30_000 }, async (t) => {
  const demo = await startDemoServer(0);
  const browser = await firefox.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await demo.close();
  });

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.addInitScript(() => {
    const prefix = '__pi_web_annotator_edit_test__';
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
        async sendMessage(message) {
          if (message.type === 'pi-web-annotator-health') {
            globalThis.__annotationHealthCalls = (globalThis.__annotationHealthCalls || 0) + 1;
            return { ok: true };
          }
          if (message.type === 'pi-web-annotator-consent') return { granted: true };
          if (message.type === 'pi-web-annotator-send') {
            globalThis.__lastAnnotationPrompt = message.job.prompt;
            return new Promise((resolve) => {
              globalThis.__finishAnnotationSend = () => resolve({ ok: true, status: 'sent' });
            });
          }
          return { ok: false };
        },
      },
    };
  });

  await page.goto(demo.origin, { waitUntil: 'networkidle' });
  await injectAnnotator(page);

  await page.getByRole('button', { name: 'Publish release' }).click();
  await page.getByLabel('Annotation note').fill('Use the approved release copy.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const healthCallsBeforeEdit = await page.evaluate(() => globalThis.__annotationHealthCalls || 0);
  const editButton = page.getByRole('button', { name: 'Edit annotation 1' });
  const editBox = await editButton.boundingBox();
  await editButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit annotation' });
  assert.ok(await dialog.isVisible());
  assert.equal(await page.getByLabel('Annotation note').inputValue(), 'Use the approved release copy.');
  assert.equal(await page.getByLabel('Annotation note').getAttribute('placeholder'), 'Edit annotation note…');
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(Math.abs(dialogBox.x - Math.max(8, Math.min(editBox.x, viewport.width - dialogBox.width - 8))) < 2);
  assert.ok(Math.abs(dialogBox.y - Math.max(8, Math.min(editBox.y + editBox.height, viewport.height - dialogBox.height - 8))) < 2);
  assert.match(await dialog.locator('.bh-primary').innerText(), /find by:/);
  assert.match(await dialog.locator('.bh-fallback').innerText(), /dom-path fallback:/);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Annotation note');
  assert.equal(await page.getByRole('button', { name: 'Save and send' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Send to Pi' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Send annotation 1 to Pi' }).isDisabled(), true);
  await page.waitForFunction((previousCount) => (globalThis.__annotationHealthCalls || 0) > previousCount, healthCallsBeforeEdit);
  assert.equal(await page.getByRole('button', { name: 'Send to Pi' }).isDisabled(), true, 'polling must not re-enable send while editing');
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    const focusedName = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.getAttribute('aria-label') || active?.textContent?.trim() || '';
    });
    assert.doesNotMatch(focusedName, /^Send(?: annotation| to Pi)/);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit annotation 1');

  await page.keyboard.press('Enter');
  await page.getByLabel('Annotation note').fill('Use the final approved release copy.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit annotation 1');

  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator.items[0].note), 'Use the final approved release copy.');
  await page.waitForFunction((expected) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      if ((localStorage.getItem(localStorage.key(index)) || '').includes(expected)) return true;
    }
    return false;
  }, 'Use the final approved release copy.');
  await page.reload({ waitUntil: 'networkidle' });
  await injectAnnotator(page);
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator.items[0].note), 'Use the final approved release copy.');
  assert.ok(await page.getByText('Use the final approved release copy.', { exact: true }).isVisible());

  await page.getByRole('button', { name: 'Edit annotation 1' }).click();
  await page.getByLabel('Annotation note').fill('This stale edit must not be saved.');
  await page.evaluate(() => { globalThis.__piWebAnnotator.items[0].piStatus = 'sent'; });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.__piWebAnnotator.items[0].note), 'Use the final approved release copy.');
  assert.ok(await page.getByText('This annotation changed state and can no longer be edited.').isVisible());

  for (const status of ['sent', 'in_progress', 'completed']) {
    await page.evaluate((nextStatus) => {
      globalThis.__piWebAnnotator.items[0].piStatus = nextStatus;
      globalThis.__piWebAnnotator.activate();
    }, status);
    assert.equal(await page.getByRole('button', { name: 'Edit annotation 1' }).isDisabled(), true, `${status} annotations must not be editable`);
  }

  await page.evaluate(() => {
    const item = globalThis.__piWebAnnotator.items[0];
    item.piStatus = 'pending';
    delete item.piJobId;
    globalThis.__piWebAnnotator.activate();
  });
  await page.getByRole('button', { name: 'Send annotation 1 to Pi' }).click();
  await page.waitForFunction(() => globalThis.__piWebAnnotator.items[0].piStatus === 'sending');
  assert.match(await page.evaluate(() => globalThis.__lastAnnotationPrompt), /Use the final approved release copy\./);
  assert.equal(await page.getByRole('button', { name: 'Edit annotation 1' }).isDisabled(), true, 'an annotation being sent must not be editable');
  await page.evaluate(() => globalThis.__finishAnnotationSend());
  await page.waitForFunction(() => globalThis.__piWebAnnotator.items[0].piStatus === 'sent');

  await context.close();
});
