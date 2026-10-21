# Rebuild the Firefox submission

The Firefox package contains readable JavaScript generated from TypeScript. Its matching source ZIP is attached to the GitHub release and uploaded to AMO with each submission. The compiler does not minify, bundle, fetch remote code, or insert timestamps.

## Environment

Use Linux with Node.js 24 and npm. CI uses Ubuntu and Node 24; local migration checks also ran on Node 26.12.0 with npm 12.2.1. Exact compiler and dependency versions are in `package-lock.json`. Download Node from <https://nodejs.org/> or use your existing version manager.

## Reproduce

Unpack the source archive into a new directory, then run from its root:

```bash
npm ci --ignore-scripts
npm run build:typescript
npm run check:build
npm run build
```

The generated JavaScript must match the submitted extension byte for byte. Compare the four files under `extension/`: `annotation-storage.js`, `background.js`, `consent.js`, and `web-annotator.js`. The other Firefox files are native assets copied unchanged from `extension/`. The unsigned ZIP is `web-ext-artifacts/pi-web-annotator-<package-version>.zip`.

The browser implementation is in `src/browser/`; browser types are in `src/browser-types.ts`. `scripts/build-typescript.mts` uses the locked TypeScript compiler with ES2022 output. It also emits the Node CLI and bridge compatibility modules, which are not part of the Firefox ZIP. PI supplies its own runtime SDK; no PI installation, credentials, browser profile, or model call is needed to rebuild the Firefox package.

For the full test gate, see `CONTRIBUTING.md`. Firefox interaction tests require the Playwright-managed Firefox browser. The node-forge source/tarball verification requires GNU tar; its vendored source is development-only and is not included in the Firefox package.
