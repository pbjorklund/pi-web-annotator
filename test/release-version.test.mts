import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChangelog, validateReleaseTag } from '../scripts/validate-release.mts';

test('accepts current release notes before verified older history', () => {
  assert.doesNotThrow(() => validateChangelog('# Changelog\n\n## 2.0.3\n\n- Ship update notes.\n\n## 2.0.2\n\n- Validate messages.\n', '2.0.3'));
});

test('rejects missing, stale, empty or duplicate current release notes', () => {
  for (const notes of [
    '# Changelog\n',
    '## 2.0.2\n\n- Older notes.\n',
    '## 2.0.3\n\n## 2.0.2\n\n- Older notes.\n',
    '## 2.0.3\n\n## Unreleased\n\n- Future notes.\n',
    '## 2.0.3\n\n- Notes.\n\n## 2.0.3\n\n- Duplicate.\n',
    '## 2.0.2\n\n- Older notes.\n\n## 2.0.3\n\n- Current notes.\n',
  ]) {
    assert.throws(() => validateChangelog(notes, '2.0.3'), /CHANGELOG.md/);
  }
});

test('accepts a release tag matching package and Firefox versions', () => {
  assert.equal(validateReleaseTag('v1.6.1', '1.6.1', '1.6.1'), 'v1.6.1');
});

test('rejects a release tag that does not match the package version', () => {
  assert.throws(
    () => validateReleaseTag('v1.6.2', '1.6.1', '1.6.1'),
    /must match package version 1.6.1/,
  );
});

test('rejects mismatched package and Firefox versions', () => {
  assert.throws(
    () => validateReleaseTag('v1.6.1', '1.6.1', '1.6.2'),
    /Package version 1.6.1 does not match Firefox version 1.6.2/,
  );
});

test('rejects tags outside the v-prefixed semantic version format', () => {
  assert.throws(
    () => validateReleaseTag('release-1.6.1', '1.6.1', '1.6.1'),
    /must use v<major>.<minor>.<patch>/,
  );
});
