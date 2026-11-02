// Generated from scripts/validate-release.mts; run npm run build:typescript. Do not edit.
import { object } from './../pi-extension/contracts.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;
export function validateReleaseTag(tag, packageVersion, firefoxVersion) {
    if (!SEMVER_TAG.test(tag)) {
        throw new Error(`Release tag ${tag || '(missing)'} must use v<major>.<minor>.<patch>`);
    }
    if (packageVersion !== firefoxVersion) {
        throw new Error(`Package version ${packageVersion} does not match Firefox version ${firefoxVersion}`);
    }
    if (tag !== `v${packageVersion}`) {
        throw new Error(`Release tag ${tag} must match package version ${packageVersion}`);
    }
    return tag;
}
export function validateChangelog(changelog, version) {
    const sections = [...changelog.matchAll(/^## ([^\r\n]+)\r?$/gm)];
    const current = sections[0];
    if (!current || current[1]?.trim() !== version || sections.filter(section => section[1]?.trim() === version).length !== 1) {
        throw new Error(`CHANGELOG.md must start with one ## ${version} release section`);
    }
    const body = changelog.slice(current.index + current[0].length, sections[1]?.index).trim();
    if (!body)
        throw new Error(`CHANGELOG.md has no release notes for ${version}`);
}
export async function validateRelease(tag) {
    const root = new URL('../', import.meta.url);
    const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
    const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
    if (!object(packageJson) || typeof packageJson.version !== 'string' || !object(manifest) || typeof manifest.version !== 'string')
        throw new Error('Invalid release metadata');
    const validatedTag = validateReleaseTag(tag, packageJson.version, manifest.version);
    validateChangelog(await readFile(new URL('CHANGELOG.md', root), 'utf8'), packageJson.version);
    return validatedTag;
}
async function main() {
    const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? '';
    const validatedTag = await validateRelease(tag);
    console.log(`Release tag ${validatedTag} matches package and Firefox versions, with current changelog notes.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : 'Release validation failed');
        process.exitCode = 1;
    });
}
