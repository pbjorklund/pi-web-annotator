import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;

export function validateReleaseTag(tag, packageVersion, firefoxVersion) {
  if (!SEMVER_TAG.test(tag)) {
    throw new Error(`Release tag ${tag || '(missing)'} must use v<major>.<minor>.<patch>`);
  }
  if (packageVersion !== firefoxVersion) {
    throw new Error(
      `Package version ${packageVersion} does not match Firefox version ${firefoxVersion}`,
    );
  }
  if (tag !== `v${packageVersion}`) {
    throw new Error(`Release tag ${tag} must match package version ${packageVersion}`);
  }
  return tag;
}

export async function validateRelease(tag) {
  const root = new URL('../', import.meta.url);
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
  return validateReleaseTag(tag, packageJson.version, manifest.version);
}

async function main() {
  const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? '';
  const validatedTag = await validateRelease(tag);
  console.log(`Release tag ${validatedTag} matches package and Firefox versions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Release validation failed');
    process.exitCode = 1;
  });
}
