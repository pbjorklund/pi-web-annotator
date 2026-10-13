import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { annotationJobMarker } from '../pi-extension/server.mjs';

const HEADER = { 'x-pi-web-annotator': '1', 'content-type': 'application/json' };

async function lifecycleFixture(t) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const previous = process.env.PI_WEB_ANNOTATOR_PORT;
  process.env.PI_WEB_ANNOTATOR_PORT = String(port);
  const { default: register } = await import(`../pi-extension/index.ts?lifecycle=${port}`);
  if (previous === undefined) delete process.env.PI_WEB_ANNOTATOR_PORT;
  else process.env.PI_WEB_ANNOTATOR_PORT = previous;
  const handlers = {}, commands = {}, notices = [], statuses = [];
  register({
    on(name, handler) { handlers[name] = handler; },
    registerCommand(name, command) { commands[name] = command; },
    sendUserMessage() {},
  });
  const ctx = {
    ui: {
      theme: { fg(_color, text) { return text; } },
      notify(message, level) { notices.push({ message, level }); },
      setStatus(_id, value) { statuses.push(value); },
    },
    isIdle() { return true; },
  };
  await handlers.session_start({}, ctx);
  t.after(() => handlers.session_shutdown({}, ctx));
  return { handlers, notices, statuses, ctx, url: `http://127.0.0.1:${port}`,
    command: action => commands['annotation-server'].handler(action, ctx) };
}

 test('concurrent starts share one owned listener without bind errors', async t => {
  const h = await lifecycleFixture(t);
  await Promise.all([h.command('start'), h.command('start')]);
  assert.deepEqual(h.notices.filter(n => n.level === 'error'), []);
  const health = await fetch(`${h.url}/health`, { headers: HEADER });
  assert.deepEqual(await health.json(), { ok: true });
});

test('shutdown drains pending startup and prevents a late listener or running status', async t => {
  const h = await lifecycleFixture(t);
  const starting = h.command('start');
  const stopping = h.handlers.session_shutdown({}, h.ctx);
  await Promise.all([starting, stopping]);
  await assert.rejects(fetch(`${h.url}/health`, { headers: HEADER }));
  assert.equal(h.statuses.at(-1), undefined);
  assert.equal(h.notices.some(n => n.message.startsWith('Annotation server listening')), false);
});

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
