import {record} from '../pi-extension/contracts.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearStalePermissionRecord } from '../scripts/prepare-dev-profile.mts';

test('removes only stale Web Annotator for Pi permission records', async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'pi-web-annotator-profile-'));
  const file = path.join(profileDir, 'extension-preferences.json');
  await writeFile(file, JSON.stringify({
    'pi-web-annotator@pbjorklund.com': { permissions: ['<all_urls>'] },
    'other@example.com': { permissions: ['tabs'] },
  }));

  assert.equal(await clearStalePermissionRecord(profileDir), true);

  const preferences = record(JSON.parse(await readFile(file, 'utf8')));
  assert.equal(preferences['pi-web-annotator@pbjorklund.com'], undefined);
  assert.deepEqual(preferences['other@example.com'], { permissions: ['tabs'] });
});

test('does nothing when the permission record is absent', async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'pi-web-annotator-profile-'));
  await writeFile(path.join(profileDir, 'extension-preferences.json'), '{}');

  assert.equal(await clearStalePermissionRecord(profileDir), false);
});
