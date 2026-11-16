import assert from 'node:assert/strict';
import test from 'node:test';
import {record} from '../pi-extension/contracts.ts';
import {isolationFixture, savedAnnotations, synthetic, untrusted} from './dom-isolation-fixture.mts';

// Characterization, not a claim that shared DOM controls authenticate a human.
// Clear's native confirmation and clipboard fallback are deliberately untested.
test('native Firefox worlds isolate APIs/state but expose origin notes and editor drafts through DOM', {timeout: 60_000}, async t => {
  const fixture = await isolationFixture(t);
  assert.equal(fixture.installedId, 'pi-web-annotator@pbjorklund.com');
  assert.equal(fixture.baseline.incognito, false, 'native target uses a regular window');
  t.diagnostic(`Native Firefox ${fixture.browserVersion}; isolated disposable debugger profile`);
  const content = record(fixture.baseline.content);
  assert.equal(content.native, 'function'); assert.equal(content.storage, 'object');
  assert.equal(content.state, 'object'); assert.equal(content.ready, true); assert.equal(content.installed, true);
  const page = await fixture.attack('read');
  assert.equal(page.browser, 'undefined'); assert.equal(page.storage, 'undefined'); assert.equal(page.state, 'undefined');
  assert.equal(page.pin, synthetic.note);
  assert.equal(typeof page.text, 'string');
  if (typeof page.text !== 'string') throw Error('Missing page-visible panel text');
  assert.ok(page.text.includes(synthetic.note)); assert.ok(page.text.includes(synthetic.other));
  assert.ok(!page.text.includes(synthetic.sentinel)); assert.ok(!page.text.includes(synthetic.hidden));
  untrusted(page, []);
  untrusted(await fixture.attack('fake'), []);
  const afterFake = await fixture.snapshot();
  assert.deepEqual(record(afterFake.content).items, content.items);
  assert.deepEqual(afterFake.stored, fixture.baseline.stored);
  untrusted(await fixture.attack('edit'), ['click']);
  const draft = 'SYNTHETIC UNSAVED EDITOR DRAFT';
  untrusted(await fixture.attack('draft', {text: draft}), []);
  assert.equal((await fixture.attack('read')).draft, draft);
  assert.deepEqual((await fixture.snapshot()).stored, fixture.baseline.stored);
});

test('page display tampering alone is cosmetic; synthetic Edit and Save persist a forged note', {timeout: 60_000}, async t => {
  const fixture = await isolationFixture(t);
  untrusted(await fixture.attack('tamper'), []);
  const cosmetic = await fixture.attack('read');
  assert.equal(cosmetic.pin, 'SYNTHETIC TITLE FORGERY');
  assert.equal(typeof cosmetic.text, 'string');
  if (typeof cosmetic.text !== 'string') throw Error('Missing tampered panel text');
  assert.ok(cosmetic.text.includes('SYNTHETIC DISPLAY FORGERY'));
  const unchanged = await fixture.snapshot();
  assert.deepEqual(unchanged.stored, fixture.baseline.stored);
  assert.deepEqual(record(unchanged.content).items, record(fixture.baseline.content).items);
  const edited = await fixture.attack('edit'); untrusted(edited, ['click']); assert.equal(edited.draft, synthetic.note);
  untrusted(await fixture.attack('draft', {text: synthetic.forged}), []);
  untrusted(await fixture.attack('save'), ['click']);
  await fixture.attack('wait', {selector: '#bh-panel .it .b > div', text: synthetic.forged});
  await fixture.attack('wait', {selector: '#bh-input[style*="display: none"]'});
  const saved = savedAnnotations(await fixture.snapshot());
  assert.equal(saved[0]?.note, synthetic.forged); assert.equal(saved[1]?.note, synthetic.other);
  assert.equal(record(saved[0]?.attrs)['data-synthetic-hidden'], synthetic.hidden);
});

test('script-dispatched checkbox change and Delete persist without trusted events', {timeout: 60_000}, async t => {
  const fixture = await isolationFixture(t);
  untrusted(await fixture.attack('check'), ['change']);
  await fixture.attack('wait', {selector: '[aria-label="Annotation 1: Completed"]:enabled'});
  assert.equal(savedAnnotations(await fixture.snapshot())[0]?.piStatus, 'completed');
  untrusted(await fixture.attack('delete'), ['click']);
  await fixture.attack('wait', {selector: '[aria-label="Delete annotation 1"]', absent: true});
  const saved = savedAnnotations(await fixture.snapshot());
  assert.deepEqual(saved.map(row => row.id), [2]); assert.equal(saved[0]?.note, synthetic.other);
});

for (const preGranted of [false, true]) {
  test(`synthetic Send with native Firefox data permission ${preGranted ? 'required in fixture manifest' : 'absent in default manifest'}`, {timeout: 60_000}, async t => {
    const fixture = await isolationFixture(t, preGranted);
    assert.equal(fixture.baseline.allowed, preGranted);
    assert.equal(await fixture.checkpoint(), 0);
    untrusted(await fixture.attack('send'), ['click']);
    if (!preGranted) {
      await fixture.attack('wait', {selector: '#bh-toast', text: 'Grant Pi access in the Firefox tab, then send again.'});
      await fixture.waitForConsent();
      const refused = await fixture.snapshot();
      assert.equal(refused.allowed, false); assert.equal(refused.consent, 1);
      assert.deepEqual(refused.stored, fixture.baseline.stored);
      assert.equal(await fixture.checkpoint(), 0, 'terminal consent refusal did not admit /jobs');
      assert.deepEqual(fixture.jobs, []);
    } else {
      await fixture.attack('wait', {selector: '[aria-label="Annotation 1: Sent to Pi"]'});
      const sent = await fixture.snapshot();
      assert.equal(sent.allowed, true); assert.equal(sent.consent, 0);
      assert.equal(savedAnnotations(sent)[0]?.piStatus, 'sent');
      assert.equal(await fixture.checkpoint(), 1);
      assert.equal(fixture.jobs.length, 1);
      const job = record(fixture.jobs[0]);
      assert.deepEqual(job.annotationIds, ['1']);
      assert.equal(typeof job.id, 'string'); assert.equal(typeof job.prompt, 'string');
      if (typeof job.prompt !== 'string') throw Error('Missing native job prompt');
      assert.ok(job.prompt.includes(synthetic.note));
      assert.ok(!job.prompt.includes(synthetic.other)); assert.ok(!job.prompt.includes(synthetic.sentinel));
    }
  });
}
