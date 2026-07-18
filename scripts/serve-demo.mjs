import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const demoDirectory = resolve(scriptsDirectory, '../demo');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
]);

function demoPath(pathname, rootDirectory) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = resolve(rootDirectory, relativePath);
  if (candidate !== rootDirectory && !candidate.startsWith(rootDirectory + sep)) return undefined;
  return candidate;
}

export async function startDemoServer(port = 4173, rootDirectory = demoDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const path = demoPath(pathname, rootDirectory);
      if (!path) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      const body = await readFile(path);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes.get(extname(path)) ?? 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      const status = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500;
      response.writeHead(status).end(status === 404 ? 'Not found' : 'Server error');
    }
  });

  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListening);
  });

  const address = server.address();
  const assignedPort = address && typeof address === 'object' ? address.port : port;
  return {
    origin: `http://127.0.0.1:${assignedPort}`,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

async function run() {
  const configuredPort = Number.parseInt(process.env.PI_WEB_ANNOTATOR_DEMO_PORT ?? '', 10);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4173;
  const demo = await startDemoServer(port);
  console.log(`Demo page: ${demo.origin}`);
  console.log('Press Ctrl+C to stop.');

  const stop = async () => {
    await demo.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
