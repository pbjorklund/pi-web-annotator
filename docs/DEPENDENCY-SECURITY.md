# Release-toolchain security fixes

Version 2.0.3 repairs the development dependency graph used to test and publish the package. None of these libraries is bundled into the Pi npm package or Firefox ZIP. Run the full audit without filters; a clean audit alone does not certify a local backport.

## Fixed registry dependencies

- `undici` stays on its consumers' existing major versions: 7.30.1 and 8.12.3. These fix the EventSource, integrity, content-encoding, redirect-cache, TLS, and WebSocket advisories reported against 7.29.1 and 8.10.2.
- `fast-uri` moves from the existing 3.1.8 override to 3.1.9, fixing the URI normalization and scheme/host confusion advisories without a major-version change.
- `minimatch` is overridden to 11.0.3. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) has no fixed earlier major. The fix bounds preprocessing expansion and avoids quadratic deduplication of large pattern sets.
- `multimatch` is overridden from 6.0.0 to 7.0.0 because the old consumer imports minimatch's removed default export. Version 7 uses the named API. The overrides retain the matching methods used by ESLint, its configuration helpers, typescript-eslint, and web-ext. Regression tests exercise their resolved copies, expansion limits, dotfiles, basename matching, and positive/negative multimatch filters. Full lint and Firefox package checks test the actual consumers.

Do not replace these overrides with `npm audit fix --force`: its proposed ESLint/web-ext downgrades do not preserve this toolchain.

## Local deepmerge backport

The registry's latest deepmerge release remains 4.3.1. [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) has no published fixed version. The upstream maintainer disputes the advisory; our regression reproduces the reported returned-object prototype poisoning without asserting global `Object.prototype` pollution.

The local build, `deepmerge@4.3.1-pi.1`, applies the `getKeys` filter from [PR 286](https://github.com/TehShrike/deepmerge/pull/286), pinned to unmerged contributor commit `9add7d91abb595703679faf7b7942bbe7f87642b`. It omits the string `__proto__` before reading or copying keys from either input. This prevents invoking the destination's prototype setter while retaining legitimate own `constructor`, `prototype`, and symbol keys. The same filter is applied to the readable CommonJS and UMD distributions consumed by the toolchain.

Provenance:

- Pristine source: <https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz>, retained as `vendor/deepmerge-4.3.1.upstream.tgz`.
- Registry integrity: `sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==`.
- Registry signing key ID: `SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA`. The key is now expired; it verifies the archive signature published with the 2023 release, not a new signature on our patch.
- Patched `index.js` SHA-256: `e51f441b914e5d78625f6dcb2c3c75a57daf1c221493d12808e3f0ebae14843c`, matching the pinned PR source.

The checker verifies the pristine archive's signature and integrity, applies the exact patch once to each implementation, and compares all eight selected source/license/type/documentation files. Only the package version and `piSecurityPatch` provenance metadata change beyond that patch. The upstream editor cache and build configuration are excluded. GNU tar reproduces the custom archive with fixed ordering, timestamps, ownership and modes. The installed copy resolved by addons-linter must match the verified tree. Tests also prove that removing the fix while retaining the custom version is rejected.

This is a local backport, not an official upstream release or upstream-certified patch. npm's advisory matching does not certify its custom prerelease version. `npm audit signatures` covers registry dependencies, not this local tarball; the signed baseline, pinned source hash, reproducible build, installed-source comparison and exploit regressions provide separate evidence. The existing node-forge backport has the same coverage distinction; see [SECURITY-BACKPORT.md](SECURITY-BACKPORT.md).

## Verify

```bash
node scripts/verify-deepmerge.mjs --rebuild
npm ci --ignore-scripts
node scripts/verify-deepmerge.mjs --check
node --import tsx --test test/dependency-security.test.mts
npm run package
npm audit
npm audit signatures
npm run release:validate -- v2.0.3
npm pack --dry-run
```

Before release, independently review the dependency overrides, patch, provenance and test coverage. Remove the local deepmerge override only when a supported fixed upstream version passes the same exploit, compatibility, audit and signature checks.
