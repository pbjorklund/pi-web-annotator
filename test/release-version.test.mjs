import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReleaseTag } from '../scripts/validate-release.mjs';

test('accepts a release tag matching package and Firefox versions', () => {
  assert.equal(validateReleaseTag('v1.6.0', '1.6.0', '1.6.0'), 'v1.6.0');
});

test('rejects a release tag that does not match the package version', () => {
  assert.throws(
    () => validateReleaseTag('v1.6.1', '1.6.0', '1.6.0'),
    /must match package version 1.6.0/,
  );
});

test('rejects mismatched package and Firefox versions', () => {
  assert.throws(
    () => validateReleaseTag('v1.6.0', '1.6.0', '1.6.1'),
    /Package version 1.6.0 does not match Firefox version 1.6.1/,
  );
});

test('rejects tags outside the v-prefixed semantic version format', () => {
  assert.throws(
    () => validateReleaseTag('release-1.6.0', '1.6.0', '1.6.0'),
    /must use v<major>.<minor>.<patch>/,
  );
});
