// Generated from scripts/source-archive.mts; run npm run build:typescript. Do not edit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { record } from './../pi-extension/contracts.mjs';
export function requireCleanSource(status) {
    if (status.trim())
        throw new Error('The AMO source archive requires a clean, committed release checkout');
}
export function createSourceArchive() {
    const root = fileURLToPath(new URL('../', import.meta.url));
    requireCleanSource(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }));
    const metadata = record(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
    if (typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.version))
        throw new Error('Invalid source archive version');
    const destination = fileURLToPath(new URL(`../web-ext-artifacts/pi-web-annotator-${metadata.version}-source.zip`, import.meta.url));
    mkdirSync(new URL('../web-ext-artifacts/', import.meta.url), { recursive: true });
    execFileSync('git', ['archive', '--format=zip', `--output=${destination}`, 'HEAD'], { cwd: root });
    return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    console.log(createSourceArchive());
