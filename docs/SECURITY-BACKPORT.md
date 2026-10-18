# Local node-forge security backport

The development toolchain uses a local Node-only build, `node-forge@1.4.0-pi.1`, to fix [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). It is based on upstream 1.4.0, not an official upstream patched release. The override applies to web-ext's adbkit dependency as well as the direct development dependency.

## Patch and provenance

The only library change is the `lib/rsa.js` patch proposed in [Forge PR 1152](https://github.com/digitalbazaar/forge/pull/1152), pinned to contributor commit `ceba34402e329f0365134f23fe19898756527d65`. The PR was unmerged when this backport was prepared. No new cryptographic algorithm is introduced.

The patched verifier requires the nested DigestAlgorithm sequence to contain exactly its OID and optional NULL. It rejects extra unconsumed children that permit low-exponent RSA signature forgery. Valid signatures with and without NULL remain accepted.

`vendor/node-forge-1.4.0.upstream.tgz` is the unmodified npm source archive:

- Source: <https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz>
- npm integrity: `sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==`
- Registry signing key ID: `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`
- Patched `lib/rsa.js` SHA-256: `acc22e5d36e27832c34e02dd3933aad7977d45b047eead5016520735efedc9c5`

The checker verifies the archived registry signature using the pinned registry public key, checks the archive integrity, applies the exact patch once, and compares every Node source file with the vendored and installed copies. The patched RSA file must match the pinned PR's complete file hash.

The local package retains the `node-forge` name, upstream license, authors, repository and source. Its custom version is `1.4.0-pi.1`; `piSecurityPatch` metadata records upstream version 1.4.0, integrity, advisory, patch commit and distribution status. Apart from that metadata, only `lib/rsa.js` differs. The Node source subset contains 52 files: all upstream `lib/*.js`, `package.json`, `LICENSE` and `README.md`. Unpatched browser bundles, source maps and Flash binaries are deliberately not installed. This package is supported here only as a Node dependency of adbkit, not as a browser or Flash distribution.

The patched tarball is built from this readable source with fixed ordering, timestamps and ownership. Its SHA-512 is recorded in `package-lock.json`. Neither vendored package is included in the public Pi npm tarball or Firefox ZIP; the pristine archive is retained only as a verification input. Do not import or install the pristine archive.

## Rebuild and verify

These commands require Node and GNU tar. They run locally without network requests or install hooks:

```bash
node scripts/verify-node-forge.mjs --rebuild
npm ci --ignore-scripts
node scripts/verify-node-forge.mjs --check
node --test test/node-forge-security.test.mjs
npm run package
npm audit
npm audit signatures
npm run release:validate -- v2.0.0
```

`npm test` includes the integrity check and security regression tests. The checker also verifies the actual Forge package resolved from web-ext through adbkit, so an unused patched copy cannot satisfy the gate. A tamper test removes the parser check while retaining the custom version and confirms that verification fails.

The exploit fixture contains only a public RSA key and signatures. Its forged signature uses exponent 3 and a cube construction with garbage inside DigestAlgorithm; generating that signature does not require the private key. Unpatched upstream 1.4.0 accepts it; the patched verifier rejects it; Node/OpenSSL rejects it independently. A valid signature for the same message remains accepted. Additional cases exercise optional NULL and extra nested elements.

## Audit and signature coverage

Run the standard full `npm audit`, including development dependencies, with no ignore list or severity filter. The custom build is not an official patched registry version, and npm's advisory matching does not certify this local prerelease. A zero-result audit is evidence about the dependency graph and registry matching, not proof that this backport is secure. The signed-source comparison, exact patch hash, exploit rejection and regression tests establish the local remediation separately. Never accept a version-only change as remediation.

`npm audit signatures` verifies registry dependencies, not the locally built tarball. The custom tarball has no upstream registry signature or attestation. Its coverage comes from the signed pristine archive, pinned patch hash, reproducible build comparison, lockfile integrity and installed-source comparison. Do not describe it as an upstream-signed patched release.

The complete upstream Node suite was also run against the backported library: 828 passing, 4 pre-existing pending, with exclusive tests forbidden. The tests came from upstream commit `723240415b25120d47146f982809fa69344ab890`, whose source archive SHA-256 is `c4434f06aec922f374139ed98dadc36f8618b4dbc1b1142fca47979ea9e66cbd`. The focused exploit tests are additional to that suite. Browser Forge bundles are not installed or supported by this backport; this does not replace the project's Firefox interaction tests.

Independent security review must accept the patch, provenance and coverage limits before release authorization. Remove the local override and direct Forge dependency only after a supported upstream patched route is available and the same exploit, regression, audit and signature checks pass.
