import {HandlerStore} from './helpers.mts';
import {object, record, required} from '../pi-extension/contracts.ts';
import type {Host, Command, SandboxHost} from '../pi-extension/host.ts';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetHost } from './widget-host.mts';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { annotationJobMarker } from '../pi-extension/server.ts';

const HEADER = { 'x-pi-web-annotator': '1', 'content-type': 'application/json' };

async function lifecycleFixture(t: TestContext, mode = 'tui') {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Missing listener address');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const previous = process.env.PI_WEB_ANNOTATOR_PORT;
  process.env.PI_WEB_ANNOTATOR_PORT = String(port);
  const imported: unknown = await import(`../pi-extension/index.ts?lifecycle=${port}`);
  const factory = record(imported).default; if (typeof factory !== 'function') throw new Error('Missing extension factory');
  const register = (host: Host) => { Reflect.apply(factory, undefined, [host]); };
  if (previous === undefined) delete process.env.PI_WEB_ANNOTATOR_PORT;
  else process.env.PI_WEB_ANNOTATOR_PORT = previous;
  const store = new HandlerStore(), handlers = store.entries, commands: Record<string, Command> = {}, notices: {message: string; level?: string}[] = [], statuses: (string | undefined)[] = [], widgets = new Map<string, string[] | undefined>();
  register({
    on(name, handler) { store.set(name, handler); },
    registerCommand(name, command) { commands[name] = command; },
    sendUserMessage() {},
  });
  const ctx = {
    mode, hasUI: mode === 'tui' || mode === 'rpc', cwd: process.cwd(),
    ui: {
      setWidget: createWidgetHost((key, value) => widgets.set(key, value)).setWidget,
      theme: { fg(_color: string, text: string) { return text; } },
      notify(message: string, level?: string) { notices.push({ message, level }); },
      setStatus(_id: string, value: string | undefined) { statuses.push(value); },
    },
    isIdle() { return true; },
  };
  await handlers.session_start({}, ctx);
  t.after(() => handlers.session_shutdown({}, ctx));
  return { handlers, notices, statuses, widgets, ctx, url: `http://127.0.0.1:${port}`,
    command: (action: string) => commands['annotator-server'].handler(action, ctx) };
}

for (const mode of ['tui', 'rpc', 'json', 'print']) {
  test(`fresh ${mode} session stays off with a configured bridge port`, async t => {
    const h = await lifecycleFixture(t, mode);
    await h.command('status');
    assert.equal(h.widgets.get('annotation-server'), undefined);
    assert.deepEqual(h.statuses, []);
    assert.equal(required(h.notices.at(-1)).message, 'Annotation server is stopped');
    await assert.rejects(fetch(`${h.url}/health`, { headers: HEADER }),
      (error: unknown) => object(error) && object(error.cause) && error.cause.code === 'ECONNREFUSED');
  });
}

test('a replacement session does not inherit a running bridge or widget', async t => {
  const h = await lifecycleFixture(t);
  await h.command('start');
  await h.handlers.session_start({}, h.ctx);
  assert.equal(h.widgets.get('annotation-server'), undefined);
  await assert.rejects(fetch(`${h.url}/health`, { headers: HEADER }),
    (error: unknown) => object(error) && object(error.cause) && error.cause.code === 'ECONNREFUSED');
});

test('concurrent starts share one owned listener without bind errors', async t => {
  const h = await lifecycleFixture(t);
  h.widgets.set('watcher-fixture', ['independent']);
  assert.equal(h.widgets.get('annotation-server'), undefined);
  await Promise.all([h.command('start'), h.command('start')]);
  assert.match(required(h.widgets.get('annotation-server'))[0], /listening/);
  await h.command('stop');
  assert.equal(h.widgets.get('annotation-server'), undefined);
  assert.deepEqual(h.widgets.get('watcher-fixture'), ['independent']);
  await h.command('start');
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
  assert.equal(h.widgets.get('annotation-server'), undefined);
  assert.equal(h.notices.some(n => n.message.startsWith('Annotation server listening')), false);
});

test('demo sandbox blocks file tools outside the demo workspace', async () => {
  const { default: registerSandbox } = await import('../pi-extension/demo-sandbox.ts');
  const handlers: {tool_call?: Parameters<SandboxHost['on']>[1]} = {};
  registerSandbox({ on(name, handler) { handlers[name] = handler; } });
  const ctx = { cwd: '/tmp/pi-web-annotator-demo' };

  assert.equal(await required(handlers.tool_call)({ toolName: 'read', input: { path: 'index.html' } }, ctx), undefined);
  assert.equal(await required(handlers.tool_call)({ toolName: 'edit', input: { path: './styles.css' } }, ctx), undefined);
  assert.deepEqual(
    await required(handlers.tool_call)({ toolName: 'read', input: { path: '../private.txt' } }, ctx),
    { block: true, reason: 'Demo file tools are limited to the temporary demo workspace' },
  );
  assert.deepEqual(
    await required(handlers.tool_call)({ toolName: 'write', input: { path: '/etc/example' } }, ctx),
    { block: true, reason: 'Demo file tools are limited to the temporary demo workspace' },
  );
});

test('Pi extension queues browser jobs as follow-ups and tracks progress', async (t) => {
  process.env.PI_WEB_ANNOTATOR_PORT = '17374';
  const { default: registerExtension } = await import('../pi-extension/index.ts');
  const store = new HandlerStore(), handlers = store.entries;
  const commands: Record<string, Command> = {};
  const sent: {prompt: string; options?: {deliverAs: 'followUp'}}[] = [];
  const pi: Host = {
    on(name, handler) { store.set(name, handler); },
    registerCommand(name, command) { commands[name] = command; },
    sendUserMessage(prompt, options) { sent.push({ prompt, options }); },
  };
  registerExtension(pi);

  const ui = {
    theme: { fg(_color: string, text: string) { return text; } },
    notify() {},
    setStatus() {},
  };
  const ctx = { ui, isIdle() { return false; } };
  await handlers.session_start({}, ctx);
  await commands['annotator-server'].handler('start', ctx);
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
  }, ctx);
  let status = await fetch('http://127.0.0.1:17374/jobs/status', {
    method: 'POST', headers: HEADER, body: JSON.stringify({ ids: ['job_abcdefgh'] }),
  });
  assert.deepEqual(await status.json(), { jobs: { job_abcdefgh: 'in_progress' } });

  await handlers.agent_settled({}, ctx);
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
  }, ctx);
  await handlers.agent_end({
    messages: [{ role: 'assistant', stopReason: 'aborted', content: [] }],
  }, ctx);
  await handlers.agent_settled({}, ctx);
  status = await fetch('http://127.0.0.1:17374/jobs/status', {
    method: 'POST', headers: HEADER, body: JSON.stringify({ ids: ['job_ijklmnop'] }),
  });
  assert.deepEqual(await status.json(), { jobs: { job_ijklmnop: 'pending' } });
});
