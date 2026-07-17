import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ADDON_IDS = [
  'pi-web-annotator@pbjorklund.com',
  'pi-web-annotator@example.com',
  'browser-annotations@pbjorklund.com',
  'browser-annotations-firefox@example.com',
];

export async function clearStalePermissionRecord(profileDir) {
  const file = path.join(profileDir, 'extension-preferences.json');
  let preferences;
  try {
    preferences = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const staleIds = ADDON_IDS.filter((id) => preferences[id]);
  if (!staleIds.length) return false;

  staleIds.forEach((id) => delete preferences[id]);
  const temporary = `${file}.pi-web-annotator.tmp`;
  const mode = (await stat(file)).mode;
  await writeFile(temporary, JSON.stringify(preferences), { mode });
  await chmod(temporary, mode);
  await rename(temporary, file);
  return true;
}

async function main() {
  const profileDir = process.env.ZEN_PROFILE
    ?? path.join(os.homedir(), '.zen', '2el4bbvx.Default (release)');
  if (await clearStalePermissionRecord(profileDir)) {
    console.log('Cleared stale Web Annotator for Pi development record.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
