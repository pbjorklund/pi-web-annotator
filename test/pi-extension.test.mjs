import assert from 'node:assert/strict';
import test from 'node:test';

import { annotationJobMarker } from '../pi-extension/server.mjs';

const HEADER = { 'x-pi-web-annotator': '1', 'content-type': 'application/json' };

test('demo sandbox blocks file tools outside the demo workspace', async () => {
  const { default: registerSandbox } = await import('../pi-extension/demo-sandbox.ts');
  const handlers = {};
  registerSandbox({ on(name, handler) { handlers[name] = handler; } });
  const ctx = { cwd: '/tmp/pi-web-annotator-demo' };

  assert.equal(await handlers.tool_call({ toolName: 'read', input: { path: 'index.html' } }, ctx), undefined);
  assert.equal(await handlers.tool_call({ toolName: 'edit', input: { path: './styles.css' } }, ctx), undefined);
  assert.deepEqual(
    await handlers.tool_call({ toolName: 'read', input: { path: '../private.txt' } }, ctx),
    { block: true, reason: 'Demo file tools are limited to the temporary demo workspace' },
  );
  assert.deepEqual(
    await handlers.tool_call({ toolName: 'write', input: { path: '/etc/example' } }, ctx),
    { block: true, reason: 'Demo file tools are limited to the temporary demo workspace' },
  );
});

test('Pi extension queues browser jobs as follow-ups and tracks progress', async (t) => {
  process.env.PI_WEB_ANNOTATOR_PORT = '17374';
  const { default: registerExtension } = await import('../pi-extension/index.ts');
  const handlers = {};
  const commands = {};
  const sent = [];
  const pi = {
    on(name, handler) { handlers[name] = handler; },
    registerCommand(name, command) { commands[name] = command; },
    sendUserMessage(prompt, options) { sent.push({ prompt, options }); },
  };
  registerExtension(pi);

  const ui = {
    theme: { fg(_color, text) { return text; } },
    notify() {},
    setStatus() {},
  };
  const ctx = { ui, isIdle() { return false; } };
  await handlers.session_start({}, ctx);
  await commands['annotation-server'].handler('start', ctx);
  t.after(async () => handlers.session_shutdown({}, ctx));

  const created = await fetch('http://127.0.0.1:17374/jobs', {
    method: 'POST',
    headers: HEADER,
    body: JSON.stringify({
      id: 'job_abcdefgh',
      prompt: 'Fix the pending annotations',
      annotationIds: ['1'],
    }),
  });
  assert.equal(created.status, 202);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { deliverAs: 'followUp' });
  assert.match(sent[0].prompt, /pi-web-annotator-job:job_abcdefgh/);

  await handlers.message_start({
    message: { role: 'user', content: `${annotationJobMarker('job_abcdefgh')}\nFix it` },
  });
  let status = await fetch('http://127.0.0.1:17374/jobs/status', {
    method: 'POST', headers: HEADER, body: JSON.stringify({ ids: ['job_abcdefgh'] }),
  });
  assert.deepEqual(await status.json(), { jobs: { job_abcdefgh: 'in_progress' } });

  await handlers.agent_settled({});
  status = await fetch('http://127.0.0.1:17374/jobs/status', {
    method: 'POST', headers: HEADER, body: JSON.stringify({ ids: ['job_abcdefgh'] }),
  });
  assert.deepEqual(await status.json(), { jobs: { job_abcdefgh: 'completed' } });

  await fetch('http://127.0.0.1:17374/jobs', {
    method: 'POST',
    headers: HEADER,
    body: JSON.stringify({
      id: 'job_ijklmnop',
      prompt: 'Retry this if Pi aborts',
      annotationIds: ['2'],
    }),
  });
  await handlers.message_start({
    message: { role: 'user', content: `${annotationJobMarker('job_ijklmnop')}\nRetry it` },
  });
  await handlers.agent_end({
    messages: [{ role: 'assistant', stopReason: 'aborted', content: [] }],
  });
  await handlers.agent_settled({});
  status = await fetch('http://127.0.0.1:17374/jobs/status', {
    method: 'POST', headers: HEADER, body: JSON.stringify({ ids: ['job_ijklmnop'] }),
  });
  assert.deepEqual(await status.json(), { jobs: { job_ijklmnop: 'pending' } });
});
