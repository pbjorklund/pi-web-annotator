import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotationJobMarker,
  createAnnotationServer,
  extractAnnotationJobId,
} from '../pi-extension/server.mjs';

const BRIDGE_HEADER = { 'x-pi-web-annotator': '1' };

async function post(url, path, body, headers = BRIDGE_HEADER) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects browser requests without the extension marker header', async (t) => {
  const bridge = await createAnnotationServer({ port: 0, onJob() {} });
  t.after(() => bridge.close());

  const response = await fetch(`${bridge.url}/health`);

  assert.equal(response.status, 403);
});

test('accepts jobs and reports their state transitions', async (t) => {
  const accepted = [];
  const bridge = await createAnnotationServer({
    port: 0,
    onJob(job) { accepted.push(job); },
  });
  t.after(() => bridge.close());

  const health = await fetch(`${bridge.url}/health`, { headers: BRIDGE_HEADER });
  assert.deepEqual(await health.json(), { ok: true });

  const created = await post(bridge.url, '/jobs', {
    id: 'job_12345678',
    prompt: 'Fix these annotations',
    annotationIds: ['1', '2'],
  });
  assert.equal(created.status, 202);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, 'job_12345678');

  bridge.markInProgress('job_12345678');
  let status = await post(bridge.url, '/jobs/status', { ids: ['job_12345678'] });
  assert.deepEqual(await status.json(), { jobs: { job_12345678: 'in_progress' } });

  bridge.markCompleted('job_12345678');
  status = await post(bridge.url, '/jobs/status', { ids: ['job_12345678'] });
  assert.deepEqual(await status.json(), { jobs: { job_12345678: 'completed' } });

  bridge.markPending('job_12345678');
  status = await post(bridge.url, '/jobs/status', { ids: ['job_12345678'] });
  assert.deepEqual(await status.json(), { jobs: { job_12345678: 'pending' } });
});

test('rejects malformed jobs', async (t) => {
  const bridge = await createAnnotationServer({ port: 0, onJob() {} });
  t.after(() => bridge.close());

  const response = await post(bridge.url, '/jobs', {
    id: 'bad',
    prompt: '',
    annotationIds: [],
  });

  assert.equal(response.status, 400);
});

test('round-trips hidden job markers', () => {
  const marked = `${annotationJobMarker('job_abcdefgh')}\nDo the work`;
  assert.equal(extractAnnotationJobId(marked), 'job_abcdefgh');
  assert.equal(extractAnnotationJobId([{ type: 'text', text: marked }]), 'job_abcdefgh');
  assert.equal(extractAnnotationJobId('normal prompt'), undefined);
});
