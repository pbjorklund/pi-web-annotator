# Contributing

## Set up

Requirements:

- Node.js 22.19 or newer for the Pi bridge test dependency (CI uses Node.js 24);
- Firefox for extension testing.

```bash
npm ci
npx playwright install firefox
npm run check
```

The Playwright-managed Firefox build runs the panel interaction test. The system Firefox installation is still used for manual extension testing.

## Run the extension

[`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) is Mozilla's extension development CLI and is installed by `npm ci`. It starts a development browser, loads the extension temporarily, and reloads it after source changes.

Start Firefox with a temporary development profile:

```bash
npm run dev
```

The maintainer-specific Zen Browser workflow uses the existing Zen profile:

```bash
npm run dev:zen
```

Both development commands watch TypeScript, regenerate the readable JavaScript, and let `web-ext` reload the extension. The Zen workflow runs Zen plus `web-ext` in an isolated process group. Press `Ctrl-C` once to stop both processes.

### Load into an existing browser

Use this method when `web-ext` cannot find your browser or when you want to test in a browser session it did not start:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on**.
3. Choose `extension/manifest.json`.
4. Use the toolbar button or `Alt+Shift+A` on a normal web page.

Temporary add-ons are removed when Firefox restarts. Firefox blocks extension injection on protected pages such as `about:` pages, the Firefox Add-ons site, PDFs, and `view-source:` pages.

## Development commands

```bash
npm run check     # Strict types, lint, negative probes, generated parity, and tests
npm test          # Contract, Firefox interaction, integration, and syntax checks
npm run lint      # Type-aware lint and Firefox validation; warnings fail
npm run typecheck # Strict non-emitting check of every maintained TS/MTS file
npm run build     # Regenerate JavaScript and build the unsigned Firefox ZIP
npm run package   # Full check and build
npm run demo:serve # Serve the local annotation target
npm run screenshots # Rebuild committed demo screenshots
npm run demo:video # Run one model-backed RPC smoke case and rebuild the MP4
```

The locked TypeScript/ESLint/tsx toolchain and PI SDK 1.3.0 are repository-managed. Browser-only consumers still have optional PI peers. Type-aware lint rejects explicit `any`, unsafe operations on untyped values, unchecked assertions, and suppression comments. Negative fixtures exercise these failures. The four browser scripts, two Pi bridge modules, and CLI MJS outputs are excluded individually in `eslint.config.ts`; only `vendor/node-forge/` is excluded as vendored source. Ordinary TS declaration files for browser globals remain inside the non-emitting check.

Use `npm run watch:typescript` to watch emission without starting a browser. Tests use isolated pages, loopback servers, and fixtures; they do not run the model-backed demo or touch an existing browser or Pi session.

## Make a change

1. Edit browser TypeScript in `src/browser/`, not the generated JavaScript in `extension/`. Keep the emitted code readable and free of remote code.
2. Add or update a focused test before changing behavior.
3. Run `npm run build:typescript` after source edits, then `npm run package`. Generated drift must fail `npm run check`, not be silently repaired by it.
4. Update `PRIVACY.md` when storage, permissions, or data transmission changes.
5. Update `THIRD_PARTY_NOTICES.md` and the shipped copy when adding bundled third-party code or changing direct development tools.

Do not commit API keys, signed XPI files, browser profiles, or user annotation data.

## Repository layout

```text
src/browser/      Maintained browser TypeScript
extension/        Generated browser JavaScript and native Firefox assets
pi-extension/     Typed Pi bridge, with generated server/contracts MJS
scripts/          Typed development helpers and generated CLI MJS
test/             Strictly checked TypeScript tests and fixtures
artwork/          Source icon and generated demo screenshots
demo/             Safe local page used for demos and captures
docs/             AMO listing and release guidance
evals/            Model-backed demo cases and deterministic graders
```

## Pull requests

Explain the user-visible reason for the change and any permission or privacy impact. Build and signing artifacts belong in `web-ext-artifacts/` and stay untracked.

Maintainers should follow [docs/RELEASING.md](docs/RELEASING.md) for Firefox Add-ons submission and signing.

By contributing, you agree that your contribution is licensed under the repository's MIT license.
