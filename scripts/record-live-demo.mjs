import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PiRpcClient } from './pi-rpc-client.mjs';
import { startDemoServer } from './serve-demo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultCasePath = resolve(root, 'evals/live-demo/cases.json');
const defaultOutput = resolve(root, 'artwork/demo/pi-web-annotator-demo.mp4');
const originalDemo = resolve(root, 'demo');
const extensionPath = resolve(root, 'pi-extension/index.ts');
const sandboxExtensionPath = resolve(root, 'pi-extension/demo-sandbox.ts');
const demoSystemPrompt = 'Work only in the current static demo directory. The annotated page is index.html and its stylesheet is styles.css. Start with index.html, make only the requested change, verify it with read, and stop.';
const annotationStoragePath = resolve(root, 'extension/annotation-storage.js');
const annotatorPath = resolve(root, 'extension/web-annotator.js');

function parseArguments(argv) {
  const options = { output: defaultOutput, casePath: defaultCasePath };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--output') options.output = resolve(argv[++index]);
    else if (argument === '--report') options.report = resolve(argv[++index]);
    else if (argument === '--case') options.casePath = resolve(argv[++index]);
    else if (argument === '--provider') options.provider = argv[++index];
    else if (argument === '--model') options.model = argv[++index];
    else if (argument === '--keep-workspace') options.keepWorkspace = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });
    child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12000); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} exited with ${code}: ${output.trim()}`));
    });
  });
}

async function waitForBridge(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { 'X-Pi-Web-Annotator': '1' },
      });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Pi annotation bridge did not become healthy');
}

function messageText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function terminalTextForTool(event) {
  const path = event.args && typeof event.args.path === 'string' ? basename(event.args.path) : 'demo file';
  if (event.toolName === 'read') return `read ${path}`;
  if (event.toolName === 'edit') return `edit ${path}`;
  if (event.toolName === 'write') return `write ${path}`;
  return event.toolName;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function compositionHtml(demoOrigin, modelLabel) {
  const safeModelLabel = escapeHtml(modelLabel);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Web Annotator for Pi live demo</title>
<style>
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}
  body{padding:16px;background:#0c0f0e;color:#eef4f1;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  .stage{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(390px,.85fr);gap:14px;height:100%}
  .window{min-width:0;overflow:hidden;border:1px solid #29322f;border-radius:14px;background:#171b1a;box-shadow:0 24px 70px rgba(0,0,0,.35)}
  .bar{height:48px;display:flex;align-items:center;gap:11px;padding:0 15px;border-bottom:1px solid #2a322f;background:#202624}
  .lights{display:flex;gap:7px}.lights span{width:11px;height:11px;border-radius:50%}.lights span:nth-child(1){background:#ef6a5b}.lights span:nth-child(2){background:#e7b64c}.lights span:nth-child(3){background:#52bd73}
  .address{flex:1;max-width:680px;margin:auto;padding:7px 14px;border:1px solid #343c39;border-radius:8px;color:#bac5c0;background:#151918;font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}
  .browser iframe{display:block;width:100%;height:calc(100% - 48px);border:0;background:#f3f2ed}
  .terminal{display:flex;flex-direction:column;background:#111413}
  .terminal .bar{justify-content:space-between}.terminal-title{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.model{color:#7f8c87;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
  #terminal-lines{flex:1;overflow:hidden;padding:18px 17px 12px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
  .line{margin:0 0 7px;white-space:pre-wrap;overflow-wrap:anywhere}.line.info{color:#a8b5af}.line.bridge{color:#35c99a}.line.browser{color:#e6b85c}.line.tool{color:#78aef5}.line.result{color:#dce5e1}.line.error{color:#f37869}.line.dim{color:#6f7c77}
  .prompt{display:flex;align-items:center;gap:8px;margin:0 17px 16px;padding:11px 12px;border:1px solid #35413d;border-radius:9px;color:#83918b;background:#181d1b;font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.prompt strong{color:#35c99a}.cursor{display:inline-block;width:7px;height:14px;background:#35c99a;animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
</style>
</head>
<body>
  <main class="stage">
    <section class="window browser" aria-label="Demo browser">
      <header class="bar"><div class="lights" aria-hidden="true"><span></span><span></span><span></span></div><div class="address">127.0.0.1 · Orbit release workspace</div></header>
      <iframe id="demo-frame" title="Orbit release workspace" src="${demoOrigin}"></iframe>
    </section>
    <section class="window terminal" aria-label="Pi RPC terminal">
      <header class="bar"><span class="terminal-title">pi · demo/</span><span class="model">${safeModelLabel}</span></header>
      <div id="terminal-lines" aria-live="polite"></div>
      <div class="prompt"><strong>demo/</strong><span>annotation bridge active</span><span class="cursor"></span></div>
    </section>
  </main>
<script>
  window.appendTerminalLine = function(kind, text) {
    const container = document.getElementById('terminal-lines');
    const line = document.createElement('div');
    line.className = 'line ' + kind;
    line.textContent = text;
    container.appendChild(line);
    while (container.children.length > 24) container.firstElementChild.remove();
    container.scrollTop = container.scrollHeight;
  };
</script>
</body>
</html>`;
}

const options = parseArguments(process.argv.slice(2));
const cases = JSON.parse(await readFile(options.casePath, 'utf8'));
const demoCase = cases[0];
if (!demoCase) throw new Error(`No demo case found in ${options.casePath}`);

const workspace = await mkdtemp(resolve(tmpdir(), 'pi-web-annotator-live-demo-'));
const videoScratch = await mkdtemp(resolve(tmpdir(), 'pi-web-annotator-video-'));
const workspaceIndex = resolve(workspace, 'index.html');
const bridgePort = await reservePort();
let demoServer;
let rpc;
let browser;
let context;
let page;
let savedVideo;
let promptHash;
let agentSettled = false;
const toolCalls = [];
const startedAt = new Date().toISOString();

try {
  await cp(originalDemo, workspace, { recursive: true });
  demoServer = await startDemoServer(0, workspace);

  const rpcArgs = [
    '--mode', 'rpc',
    '--no-session',
    '--no-context-files',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-approve',
    '--tools', 'read,edit,write',
    '--thinking', 'low',
    '--append-system-prompt', demoSystemPrompt,
    '-e', extensionPath,
    '-e', sandboxExtensionPath,
  ];
  if (options.provider) rpcArgs.push('--provider', options.provider);
  if (options.model) rpcArgs.push('--model', options.model);

  rpc = PiRpcClient.start({
    cwd: workspace,
    args: rpcArgs,
    env: {
      ...process.env,
      PI_SKIP_VERSION_CHECK: '1',
      PI_TELEMETRY: '0',
      PI_WEB_ANNOTATOR_PORT: String(bridgePort),
    },
  });

  const stateResponse = await rpc.send({ type: 'get_state' });
  const model = stateResponse.data.model;
  if (!model) throw new Error('Pi RPC has no configured model');
  await rpc.send({ type: 'set_auto_retry', enabled: false });

  const configuredBrowser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const systemBrowser = [configuredBrowser, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    .find((path) => path && existsSync(path));
  browser = await chromium.launch({
    headless: process.env.DEMO_HEADLESS !== '0',
    ...(systemBrowser ? { executablePath: systemBrowser } : {}),
  });
  context = await browser.newContext({
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: videoScratch, size: { width: 1600, height: 900 } },
  });
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  async function bridgeMessage(message) {
    if (message.type === 'pi-web-annotator-consent') return { granted: true };
    let path;
    let init = { headers: { 'X-Pi-Web-Annotator': '1' } };
    if (message.type === 'pi-web-annotator-health') path = '/health';
    else if (message.type === 'pi-web-annotator-send') {
      path = '/jobs';
      promptHash = sha256(message.job.prompt);
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pi-Web-Annotator': '1' },
        body: JSON.stringify(message.job),
      };
    } else if (message.type === 'pi-web-annotator-status') {
      path = '/jobs/status';
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pi-Web-Annotator': '1' },
        body: JSON.stringify({ ids: message.jobIds }),
      };
    } else return { ok: false, error: 'Unsupported demo bridge message' };

    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}${path}`, init);
      const body = await response.json();
      return response.ok ? { ok: true, ...body } : { ok: false, error: body.error ?? 'Bridge request failed' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Bridge unavailable' };
    }
  }

  await page.exposeFunction('__piDemoBridge', bridgeMessage);
  await page.addInitScript(() => {
    const storagePrefix = '__pi_web_annotator_demo_storage__';
    globalThis.browser = {
      storage: {
        local: {
          async get(key) {
            const raw = localStorage.getItem(storagePrefix + key);
            return raw === null ? {} : { [key]: JSON.parse(raw) };
          },
          async set(values) {
            for (const [key, value] of Object.entries(values)) {
              localStorage.setItem(storagePrefix + key, JSON.stringify(value));
            }
          },
        },
      },
      runtime: {
        sendMessage(message) {
          return globalThis.__piDemoBridge(message);
        },
      },
    };
  });

  await page.goto(demoServer.origin, { waitUntil: 'networkidle' });
  await page.setContent(compositionHtml(demoServer.origin, `${model.provider}/${model.id}`), { waitUntil: 'domcontentloaded' });
  const frameHandle = await page.locator('#demo-frame').elementHandle();
  let frame = await frameHandle.contentFrame();
  await frame.waitForURL((url) => url.origin === demoServer.origin, { timeout: 15000 });
  await frame.waitForLoadState('networkidle');

  let renderQueue = Promise.resolve();
  const appendTerminal = (kind, text) => {
    const safeText = String(text)
      .replaceAll(workspace, 'demo/')
      .replaceAll(videoScratch, '<video>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!safeText) return;
    renderQueue = renderQueue
      .then(() => page.evaluate(([lineKind, lineText]) => window.appendTerminalLine(lineKind, lineText), [kind, safeText]))
      .catch(() => {});
  };

  appendTerminal('info', `Pi RPC connected · ${model.provider}/${model.id}`);
  appendTerminal('dim', 'ephemeral session · read/edit/write only');

  const unsubscribe = rpc.onEvent((event) => {
    if (event.type === 'extension_ui_request' && event.method === 'notify') {
      appendTerminal(event.notifyType === 'error' ? 'error' : 'bridge', event.message);
    } else if (event.type === 'agent_start') {
      appendTerminal('info', 'Pi received the browser annotation');
    } else if (event.type === 'tool_execution_start') {
      toolCalls.push(event.toolName);
      appendTerminal('tool', `> ${terminalTextForTool(event)}`);
    } else if (event.type === 'tool_execution_end') {
      appendTerminal(event.isError ? 'error' : 'dim', `${event.isError ? 'failed' : 'done'} · ${event.toolName}`);
    } else if (event.type === 'message_end') {
      const text = messageText(event.message);
      if (text) appendTerminal('result', text);
    } else if (event.type === 'agent_settled') {
      agentSettled = true;
      appendTerminal('bridge', 'Pi finished the annotation');
    } else if (event.type === 'extension_error') {
      appendTerminal('error', `Extension error: ${event.error}`);
    }
  });

  await rpc.send({ type: 'prompt', message: '/annotation-server start' });
  await waitForBridge(bridgePort);
  appendTerminal('bridge', `annotation bridge ready · 127.0.0.1:${bridgePort}`);

  async function injectAnnotator(targetFrame) {
    await targetFrame.evaluate(() => {
      const storagePrefix = '__pi_web_annotator_demo_storage__';
      globalThis.browser = {
        storage: {
          local: {
            async get(key) {
              const raw = localStorage.getItem(storagePrefix + key);
              return raw === null ? {} : { [key]: JSON.parse(raw) };
            },
            async set(values) {
              for (const [key, value] of Object.entries(values)) {
                localStorage.setItem(storagePrefix + key, JSON.stringify(value));
              }
            },
          },
        },
        runtime: {
          sendMessage(message) {
            return globalThis.__piDemoBridge(message);
          },
        },
      };
    });
    await targetFrame.addScriptTag({ path: annotationStoragePath });
    await targetFrame.addScriptTag({ path: annotatorPath });
    await delay(250);
    const diagnostic = await targetFrame.evaluate(() => ({
      browser: typeof globalThis.browser,
      bridge: typeof globalThis.__piDemoBridge,
      storage: typeof globalThis.PiWebAnnotatorStorage,
      annotator: globalThis.__piWebAnnotator ? {
        installed: globalThis.__piWebAnnotator.installed,
        ready: globalThis.__piWebAnnotator.ready,
      } : null,
    }));
    if (!diagnostic.annotator?.ready) {
      throw new Error(`Annotator injection failed: ${JSON.stringify({ diagnostic, pageErrors })}`);
    }
    await targetFrame.locator('[aria-label="Pi connected"]').waitFor();
  }

  await injectAnnotator(frame);
  appendTerminal('browser', 'Browser capture is active');
  await delay(900);

  await frame.locator(demoCase.selector).click({ position: { x: 260, y: 55 } });
  const noteInput = frame.getByRole('textbox', { name: 'Annotation note' });
  await noteInput.pressSequentially(demoCase.annotation, { delay: 24 });
  appendTerminal('browser', `Annotation #1 · ${demoCase.annotation}`);
  await delay(1100);

  const settled = rpc.waitForEvent((event) => event.type === 'agent_settled', 120000);
  await frame.getByRole('button', { name: 'Save and send', exact: true }).click();
  appendTerminal('browser', 'Sent annotation to Pi');
  await settled;
  await renderQueue;

  const updatedHtml = await readFile(workspaceIndex, 'utf8');
  if (!updatedHtml.includes(demoCase.expectedText)) {
    throw new Error(`Model did not produce expected text: ${demoCase.expectedText}`);
  }
  if (updatedHtml.includes(demoCase.originalText)) {
    throw new Error('Model left the original heading in the demo page');
  }

  await frame.waitForFunction(() => document.querySelectorAll('#bh-list input.state-check:checked').length === 1, null, { timeout: 10000 });
  appendTerminal('result', `Verified index.html · heading is now "${demoCase.expectedText}"`);
  await delay(1700);

  await frame.goto(demoServer.origin, { waitUntil: 'networkidle' });
  frame = frameHandle ? await frameHandle.contentFrame() : frame;
  await injectAnnotator(frame);
  await frame.locator(demoCase.selector).waitFor();
  const finalHeading = (await frame.locator(demoCase.selector).textContent()).trim();
  if (finalHeading !== demoCase.expectedText) throw new Error(`Browser shows unexpected heading: ${finalHeading}`);
  appendTerminal('bridge', 'Reloaded browser · model change is visible');
  await renderQueue;
  await delay(2800);

  const statsResponse = await rpc.send({ type: 'get_session_stats' });
  await rpc.send({ type: 'prompt', message: '/annotation-server stop' });
  unsubscribe();

  const video = page.video();
  const webmPath = resolve(videoScratch, 'pi-web-annotator-demo.webm');
  await page.close();
  await video.saveAs(webmPath);
  await context.close();
  context = undefined;

  await mkdir(dirname(options.output), { recursive: true });
  await run(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', webmPath,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    options.output,
  ]);
  savedVideo = options.output;
  const videoInfo = await stat(options.output);

  const report = {
    success: true,
    caseId: demoCase.id,
    privacy: demoCase.privacy,
    startedAt,
    completedAt: new Date().toISOString(),
    source: {
      gitCommit: process.env.PI_DEMO_GIT_COMMIT ?? null,
      dirty: process.env.PI_DEMO_GIT_DIRTY === '1',
      casePath: options.casePath,
      promptSha256: promptHash,
      systemPromptSha256: sha256(demoSystemPrompt),
    },
    runtime: {
      provider: model.provider,
      model: model.id,
      thinkingLevel: 'low',
      allowedTools: ['read', 'edit', 'write'],
      autoRetry: false,
      ephemeralSession: true,
      temporaryWorkspace: true,
      pathSandbox: true,
    },
    outcome: {
      originalText: demoCase.originalText,
      expectedText: demoCase.expectedText,
      finalText: demoCase.expectedText,
      agentSettled,
      toolCalls,
    },
    usage: statsResponse.data,
    video: {
      path: options.output,
      bytes: videoInfo.size,
      format: 'mp4',
      width: 1600,
      height: 900,
    },
  };

  if (options.report) {
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (rpc) await rpc.close().catch(() => {});
  if (demoServer) await demoServer.close().catch(() => {});
  if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  await rm(videoScratch, { recursive: true, force: true });
  if (savedVideo) console.error(`Demo video: ${savedVideo}`);
}
