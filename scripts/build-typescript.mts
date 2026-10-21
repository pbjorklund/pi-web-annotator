import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
function outputs(directory: string): Map<string, string> {
  const sources = [
    ...fs.readdirSync(path.join(directory, 'src/browser')).filter(file => file.endsWith('.ts')).map(file => `src/browser/${file}`),
    'pi-extension/server.ts', 'pi-extension/contracts.ts',
    ...fs.readdirSync(path.join(directory, 'scripts')).filter(file => file.endsWith('.mts') && file !== 'check-tooling.mts').map(file => `scripts/${file}`),
  ];
  return new Map(sources.map(source => [source, source.startsWith('src/browser/') ? source.replace('src/browser/', 'extension/').replace(/\.ts$/, '.js') : source.replace(/\.(mts|ts)$/, '.mjs')]));
}

export function buildTypescript(directory = root, check = false): boolean {
  const files = outputs(directory);
  let fresh = true;
  for (const [source, output] of files) {
    let code = fs.readFileSync(path.join(directory, source), 'utf8');
    code = code.replace(/(['"])(\.{1,2}\/[^'"\n]+\.(?:mts|ts))\1/g, (original: string, quote: string, relative: string) => {
      const target = path.relative(directory, path.resolve(directory, path.dirname(source), relative)).split(path.sep).join('/');
      const built = files.get(target);
      return built ? quote + './' + path.relative(path.dirname(output), built).split(path.sep).join('/') + quote : original;
    });
    const text = '// Generated from ' + source + '; run npm run build:typescript. Do not edit.\n' + ts.transpileModule(code, {fileName: source, compilerOptions: {target: ts.ScriptTarget.ES2022, module: source.startsWith('src/browser/') ? ts.ModuleKind.None : ts.ModuleKind.ESNext, newLine: ts.NewLineKind.LineFeed}}).outputText;
    const destination = path.join(directory, output);
    if (check) {
      if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== text) { console.error(`Stale generated output: ${output}`); fresh = false; }
    } else fs.writeFileSync(destination, text);
  }
  return fresh;
}

export function watchTypescript(directory = root, onBuild: () => void = () => {}) {
  buildTypescript(directory);
  const files = outputs(directory);
  let closed = false;
  const watchers = ['src/browser', 'scripts', 'pi-extension'].map(folder => fs.watch(path.join(directory, folder), (_event, name) => {
    if (closed || !name || !files.has(`${folder}/${name}`)) return;
    buildTypescript(directory);
    onBuild();
  }));
  return () => { closed = true; for (const watcher of watchers) watcher.close(); };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--watch')) {
    const close = watchTypescript();
    process.once('SIGINT', () => {close(); process.exitCode = 130;});
    process.once('SIGTERM', () => {close(); process.exitCode = 143;});
  } else if (!buildTypescript(root, process.argv.includes('--check'))) process.exitCode = 1;
}
