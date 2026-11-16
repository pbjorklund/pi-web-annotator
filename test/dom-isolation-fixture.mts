import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse, type Server} from 'node:http';
import {createConnection, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TestContext} from 'node:test';
import {firefox, type BrowserContext} from 'playwright';
import {record} from '../pi-extension/contracts.ts';

const deadline = 15_000;
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  // A resource can fail before its consumer starts waiting.
  void promise.catch(() => {});
  return {promise, resolve, reject};
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error(label)), deadline);})]);}
  finally {clearTimeout(timer);}
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let data = '';
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) throw Error('Non-buffer HTTP input');
    data += chunk.toString('utf8');
    if (Buffer.byteLength(data) > 1_048_576) throw Error('Oversized fixture input');
  }
  const parsed: unknown = JSON.parse(data);
  return record(parsed);
}
function json(response: ServerResponse, value: unknown) {
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value));
}
class Mailbox {
  private response: ServerResponse | undefined;
  private ready = deferred<void>();
  private pending: {id: number; result: ReturnType<typeof deferred<Record<string, unknown>>>} | undefined;
  private sequence = 0;
  constructor(readonly path: string) {}
  async serve(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'GET') {
      assert.equal(this.response, undefined, 'only one mailbox reader');
      this.response = response; this.ready.resolve();
    } else if (request.method === 'POST') {
      const result = await body(request);
      assert.equal(result.id, this.pending?.id);
      const pending = this.pending; this.pending = undefined;
      if (!pending) throw Error('Unexpected mailbox result');
      pending.result.resolve(result); json(response, {});
    } else {response.writeHead(405); response.end();}
  }
  async command(op: string, args: Record<string, unknown> = {}) {
    await bounded(this.ready.promise, `Mailbox reader missing: ${op}`);
    assert.equal(this.pending, undefined);
    const response = this.response;
    if (!response) throw Error('Missing mailbox response');
    this.response = undefined; this.ready = deferred<void>();
    const result = deferred<Record<string, unknown>>(), id = ++this.sequence;
    this.pending = {id, result}; json(response, {id, op, ...args});
    const reply = await bounded(result.promise, `Mailbox result missing: ${op}`);
    if (typeof reply.error === 'string') throw Error(reply.error);
    return record(reply.value);
  }
  close() {
    this.response?.end(); this.response = undefined;
    this.pending?.result.reject(Error('Mailbox closed')); this.ready.reject(Error('Mailbox closed'));
  }
}

// Only this connection's UNIX socket is used; no TCP debugger discovery or existing browser.
class Rdp {
  private input = Buffer.alloc(0);
  private packets: Record<string, unknown>[] = [];
  private waiter: {predicate: (packet: Record<string, unknown>) => boolean; result: ReturnType<typeof deferred<Record<string, unknown>>>} | undefined;
  private failure: Error | undefined;
  constructor(readonly socket: Socket) {
    socket.on('data', (data: Buffer) => {
      try {
        this.input = Buffer.concat([this.input, data]);
        if (this.input.length > 4_194_304) throw Error('Oversized RDP input');
        while (true) {
          const colon = this.input.indexOf(58);
          if (colon < 0) {if (this.input.length > 10) throw Error('Invalid RDP prefix'); break;}
          const prefix = this.input.subarray(0, colon).toString('ascii');
          if (!/^\d{1,10}$/.test(prefix)) throw Error('Invalid RDP length');
          const length = Number(prefix);
          if (length > 2_097_152) throw Error('Oversized RDP packet');
          if (this.input.length < colon + 1 + length) break;
          const parsed: unknown = JSON.parse(this.input.subarray(colon + 1, colon + 1 + length).toString('utf8'));
          const packet = record(parsed); this.input = this.input.subarray(colon + 1 + length);
          if (this.waiter?.predicate(packet)) {const waiter = this.waiter; this.waiter = undefined; waiter.result.resolve(packet);}
          else {if (this.packets.length >= 64) throw Error('RDP queue overflow'); this.packets.push(packet);}
        }
      } catch (error) {this.fail(error instanceof Error ? error : Error(String(error)));}
    });
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(Error('RDP socket closed')));
  }
  private fail(error: Error) {this.failure = error; this.waiter?.result.reject(error); this.waiter = undefined; this.socket.destroy();}
  async next(predicate: (packet: Record<string, unknown>) => boolean) {
    if (this.failure) throw this.failure;
    const index = this.packets.findIndex(predicate);
    if (index >= 0) {const packet = this.packets.splice(index, 1)[0]; if (packet) return packet;}
    assert.equal(this.waiter, undefined);
    const result = deferred<Record<string, unknown>>(); this.waiter = {predicate, result};
    try {return await bounded(result.promise, 'RDP deadline');}
    catch (error) {this.fail(error instanceof Error ? error : Error(String(error))); throw error;}
  }
  async request(to: string, type: string, extra: Record<string, unknown> = {}) {
    const reply = this.next(packet => packet.from === to && (!packet.type || !!packet.error));
    const payload = Buffer.from(JSON.stringify({to, type, ...extra}));
    this.socket.write(Buffer.concat([Buffer.from(`${payload.byteLength}:`), payload]));
    const result = await reply;
    assert.equal(result.error, undefined, JSON.stringify(result)); return result;
  }
}

// Static page script: every action starts in a fetch continuation, never Playwright evaluate.
function pageScript(mailbox: string) {
  return `const mailbox=${JSON.stringify(mailbox)};
  const rec=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid command');return v;};
  const need=s=>{const n=document.querySelector(s);if(!n)throw Error('Missing '+s);return n;};
  const click=s=>{const n=need(s);if(n.disabled)throw Error('Disabled '+s);n.click();};
  const events=[];for(const type of ['click','change'])document.addEventListener(type,e=>events.push({type,trusted:e.isTrusted,active:navigator.userActivation.isActive}),true);
  (async()=>{while(true){const c=rec(await(await fetch(mailbox)).json());let value,error;try{
    const active=navigator.userActivation.isActive;events.length=0;
    if(c.op==='wait'){await new Promise(resolve=>{const done=()=>{const n=document.querySelector(c.selector);return c.absent?!n:!!n&&(c.text===undefined||n.textContent===c.text);};if(done())return resolve();const observer=new MutationObserver(()=>{if(done()){observer.disconnect();resolve();}});observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});});value={};}
    else if(c.op==='read')value={browser:typeof window.browser,storage:typeof window.PiWebAnnotatorStorage,state:typeof window.__piWebAnnotator,text:need('#bh-panel').textContent,pin:need('.bh-pin').title,draft:document.querySelector('textarea[aria-label="Annotation note"]')?.value};
    else if(c.op==='fake'){window.__piWebAnnotator={installed:true,ready:true,items:[{id:999,note:'SYNTHETIC FAKE'}],destroy(){this.items=[];return 'fake';}};window.__piWebAnnotator.destroy();value={fake:window.__piWebAnnotator.items};}
    else if(c.op==='tamper'){need('#bh-panel .it .b > div').textContent='SYNTHETIC DISPLAY FORGERY';need('.bh-pin').title='SYNTHETIC TITLE FORGERY';value={};}
    else if(c.op==='edit'){click('[aria-label="Edit annotation 1"]');value={draft:need('textarea[aria-label="Annotation note"]').value};}
    else if(c.op==='draft'){need('textarea[aria-label="Annotation note"]').value=c.text;value={draft:need('textarea[aria-label="Annotation note"]').value};}
    else if(c.op==='save'){const selector='#bh-input .bh-row > button:nth-child(2)';if(need(selector).textContent!=='Save')throw Error('Unexpected Save control');click(selector);value={};}
    else if(c.op==='check'){const n=need('#bh-panel .state-check');n.checked=true;n.dispatchEvent(new Event('change',{bubbles:true}));value={};}
    else if(c.op==='delete'){click('[aria-label="Delete annotation 1"]');value={};}
    else if(c.op==='send'){click('[aria-label="Send annotation 1 to Pi"]');value={};}
    else throw Error('Unknown page command');
    value={...value,active,events:events.slice()};
  }catch(e){error=String(e);}await fetch(mailbox,{method:'POST',body:JSON.stringify({id:c.id,value,error})});}})();`;
}
function backgroundScript(mailbox: string, target: string) {
  return `const fixtureMailbox=${JSON.stringify(mailbox)},fixtureTarget=${JSON.stringify(target)};
  const fixtureRec=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid command');return v;};
  (async()=>{while(true){const c=fixtureRec(await(await fetch(fixtureMailbox)).json());let value,error;try{
    const tabs=await browser.tabs.query({}),tab=tabs.find(t=>t.url===fixtureTarget);if(!tab||!Number.isInteger(tab.id))throw Error('Missing owned target');
    if(c.op==='seed'){await browser.storage.local.set(c.values);value={seeded:await browser.storage.local.get(Object.keys(c.values))};await browser.scripting.executeScript({target:{tabId:tab.id},files:['annotation-storage.js','web-annotator.js']});}
    else if(c.op==='snapshot'){
      const results=await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>({native:typeof browser.runtime.sendMessage,storage:typeof PiWebAnnotatorStorage,state:typeof window.__piWebAnnotator,ready:window.__piWebAnnotator?.ready,installed:window.__piWebAnnotator?.installed,items:window.__piWebAnnotator?.items})});
      value={incognito:tab.incognito,content:results[0].result,stored:await browser.storage.local.get(c.key),allowed:await browser.permissions.contains({data_collection:['browsingActivity','websiteContent']}),consent:tabs.filter(t=>t.url===browser.runtime.getURL('consent.html')).length};
    }else throw Error('Unknown native command');
  }catch(e){error=String(e);}await fetch(fixtureMailbox,{method:'POST',body:JSON.stringify({id:c.id,value,error})});}})();`;
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', () => {server.removeListener('error', reject); resolve();});});
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing loopback port');
  assert.notEqual(address.port, 17373); return `http://127.0.0.1:${address.port}`;
}
async function compareCopy(source: string, copy: string, expected: Map<string, Buffer>, prefix = ''): Promise<void> {
  for (const entry of await readdir(source, {withFileTypes: true})) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await compareCopy(join(source, entry.name), join(copy, entry.name), expected, name + '/');
    else assert.deepEqual(await readFile(join(copy, entry.name)), expected.get(name) ?? await readFile(join(source, entry.name)), `Copied artifact: ${name}`);
  }
}
export const synthetic = {
  note: 'SYNTHETIC PRIVATE ROW ONE', other: 'SYNTHETIC OTHER PATH NOTE', sentinel: 'SYNTHETIC UNRELATED ORIGIN SENTINEL',
  hidden: 'SYNTHETIC HIDDEN METADATA', forged: 'SYNTHETIC PAGE FORGED SAVED NOTE',
};
export async function isolationFixture(t: TestContext, preGranted = false) {
  const owned = await mkdtemp(join(tmpdir(), 'pi-dom-isolation-'));
  const pageBox = new Mailbox('/page-' + randomBytes(24).toString('hex'));
  const nativeBox = new Mailbox('/native-' + randomBytes(24).toString('hex'));
  const jobs: Record<string, unknown>[] = [];
  let context: BrowserContext | undefined, rdp: Rdp | undefined;
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    pageBox.close(); nativeBox.close(); rdp?.socket.destroy();
    try {await context?.close();}
    finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise<void>(resolve => {server.close(() => resolve()); server.closeAllConnections();})));
      await rm(owned, {recursive: true, force: true});
    }
  }
  t.after(close);
  function server(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
    const result = createServer((request, response) => {void handler(request, response).catch(error => {response.writeHead(500); response.end(String(error));});});
    result.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
    servers.push(result); return result;
  }
  try {
    const bridge = await listen(server(async (request, response) => {
      if (request.url === '/jobs') {
        assert.equal(request.method, 'POST'); assert.equal(request.headers['x-pi-web-annotator'], '1');
        jobs.push(await body(request)); json(response, {status: 'sent'});
      } else if (request.url === '/jobs/status') {await body(request); json(response, {jobs: Object.fromEntries(jobs.map(job => [String(job.id), 'sent']))});}
      else if (request.url === '/checkpoint') json(response, {count: jobs.length});
      else if (request.url === '/health') json(response, {ok: true});
      else {response.writeHead(404); response.end();}
    }));
    const origin = await listen(server(async (request, response) => {
      if (request.url === pageBox.path) return pageBox.serve(request, response);
      if (request.url === nativeBox.path) return nativeBox.serve(request, response);
      if (request.url === '/hostile.js') {response.setHeader('Content-Type', 'text/javascript'); response.end(pageScript(pageBox.path)); return;}
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>SYNTHETIC hostile target</title><h1 id="target">SYNTHETIC target</h1><script src="/hostile.js"></script>');
    }));
    assert.notEqual(origin, bridge);
    const target = origin + '/review', key = 'pi-web-annotator:collection:v2:' + origin;
    const source = fileURLToPath(new URL('../extension', import.meta.url)), addon = join(owned, 'addon');
    await cp(source, addon, {recursive: true});
    const originalManifest: unknown = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
    const manifest = structuredClone(record(originalManifest));
    const background = record(manifest.background);
    assert.deepEqual(background.scripts, ['background.js']); background.scripts = ['background.js', 'fixture.js'];
    const gecko = record(record(manifest.browser_specific_settings).gecko);
    assert.deepEqual(gecko.data_collection_permissions, {required: ['none'], optional: ['browsingActivity', 'websiteContent']});
    // Test-only native grant condition, not evidence about optional-permission consent UX.
    if (preGranted) {
      gecko.data_collection_permissions = {required: ['browsingActivity', 'websiteContent']};
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const originalBackground = await readFile(join(source, 'background.js'), 'utf8');
    const endpoint = 'http://127.0.0.1:17373'; assert.equal(originalBackground.split(endpoint).length, 2);
    const backgroundBytes = Buffer.from(originalBackground.replace(endpoint, bridge));
    await writeFile(join(addon, 'manifest.json'), manifestBytes); await writeFile(join(addon, 'background.js'), backgroundBytes);
    await writeFile(join(addon, 'fixture.js'), backgroundScript(origin + nativeBox.path, target));
    await compareCopy(source, addon, new Map([['manifest.json', manifestBytes], ['background.js', backgroundBytes]]));
    const profile = join(owned, 'profile'); await mkdir(profile);
    await writeFile(join(profile, 'user.js'), Object.entries({'devtools.debugger.remote-enabled': true, 'devtools.chrome.enabled': true, 'devtools.debugger.prompt-connection': false, 'devtools.debugger.force-local': true}).map(([name, value]) => `user_pref(${JSON.stringify(name)},${value});`).join('\n'));
    const socketPath = join(owned, 'debug.sock');
    context = await firefox.launchPersistentContext(profile, {headless: true, args: ['--start-debugger-server', socketPath]});
    const page = await context.newPage(); page.setDefaultTimeout(deadline); await page.goto(target);
    rdp = new Rdp(createConnection({path: socketPath}));
    await rdp.next(packet => typeof packet.applicationType === 'string');
    const root = await rdp.request('root', 'getRoot'); assert.equal(typeof root.addonsActor, 'string');
    if (typeof root.addonsActor !== 'string') throw Error('Missing addons actor');
    const installed = await rdp.request(root.addonsActor, 'installTemporaryAddon', {addonPath: addon, openDevTools: false});
    const expectedId = record(record(record(originalManifest).browser_specific_settings).gecko).id;
    assert.equal(record(installed.addon).id, expectedId);
    const annotation = (id: number, note: string, pageUrl: string) => ({id, type: 'element', selector: '#target', tag: 'h1', pageKey: pageUrl, pageUrl, rect: {x: 0, y: 0, w: 40, h: 20}, note, ts: 0, piStatus: 'pending', attrs: {'data-synthetic-hidden': synthetic.hidden}});
    const envelope = (rows: unknown[]) => ({schema: 2, revision: 1, nextId: rows.length + 1, rows: rows.map(annotation => ({revision: 1, annotation}))});
    const sentinelKey = 'pi-web-annotator:collection:v2:https://synthetic-unrelated.invalid';
    const values = {[key]: envelope([annotation(1, synthetic.note, target), annotation(2, synthetic.other, origin + '/other-path')]), [sentinelKey]: envelope([annotation(1, synthetic.sentinel, 'https://synthetic-unrelated.invalid/')])};
    assert.deepEqual((await nativeBox.command('seed', {values})).seeded, values, 'Native storage seed readback');
    await pageBox.command('wait', {selector: '[aria-label="Pi connected"]'});
    await pageBox.command('wait', {selector: '#bh-panel .it'});
    const snapshot = () => nativeBox.command('snapshot', {key});
    const baseline = await snapshot(); assert.equal(baseline.allowed, preGranted);
    return {browserVersion: context.browser()?.version(), snapshot, attack: (op: string, args?: Record<string, unknown>) => pageBox.command(op, args), jobs,
      async checkpoint() {const value: unknown = await (await fetch(bridge + '/checkpoint')).json(); return record(value).count;},
      baseline, installedId: expectedId, preGranted,
    };
  } catch (error) {await close(); throw error;}
}
export function savedAnnotations(snapshot: Record<string, unknown>): Record<string, unknown>[] {
  const stored = record(snapshot.stored), envelope = record(Object.values(stored)[0]);
  assert.equal(envelope.schema, 2); assert.equal(typeof envelope.revision, 'number');
  if (!Array.isArray(envelope.rows)) throw Error('Invalid native collection rows');
  const rows: unknown[] = envelope.rows;
  return rows.map(row => record(record(row).annotation));
}
export function untrusted(result: Record<string, unknown>, expectedEvents: string[]) {
  assert.equal(result.active, false, 'network task has no transient user activation');
  assert.ok(Array.isArray(result.events)); const events: unknown[] = result.events;
  assert.deepEqual(events.map(event => record(event).type), expectedEvents);
  for (const event of events) {assert.equal(record(event).trusted, false); assert.equal(record(event).active, false);}
}
