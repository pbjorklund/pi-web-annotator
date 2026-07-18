# Contributing

## Set up

Requirements:

- Node.js 20 or newer;
- Firefox for extension testing.

```bash
npm ci
npm test
npm run lint
```

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

### Load into an existing browser

Use this method when `web-ext` cannot find your browser or when you want to test in a browser session it did not start:

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on**.
3. Choose `extension/manifest.json`.
4. Use the toolbar button or `Alt+Shift+A` on a normal web page.

Temporary add-ons are removed when Firefox restarts. Firefox blocks extension injection on protected pages such as `about:` pages, the Firefox Add-ons site, PDFs, and `view-source:` pages.

## Development commands

```bash
npm test          # Contract, integration, and syntax checks
npm run lint      # Firefox extension validation
npm run build     # Unsigned ZIP in web-ext-artifacts/
npm run package   # Test, lint, and build
npm run demo:serve # Serve the local annotation target
npm run screenshots # Rebuild committed demo screenshots
npm run demo:video # Run one model-backed RPC smoke case and rebuild the MP4
```

## Make a change

1. Keep the shipped source in `extension/` readable and free of remote code.
2. Add or update a focused test before changing behavior.
3. Run `npm test`, `npm run lint`, and `npm run build`.
4. Update `PRIVACY.md` when storage, permissions, or data transmission changes.
5. Update `THIRD_PARTY_NOTICES.md` and the shipped copy when adding bundled third-party code or changing direct development tools.

Do not commit API keys, signed XPI files, browser profiles, or user annotation data.

## Repository layout

```text
extension/        Firefox package source, shipped without a build step
pi-extension/     Optional local Pi package and loopback server
scripts/          Development and packaging helpers
test/             Node-based contract and integration tests
artwork/          Source icon and generated demo screenshots
demo/             Safe local page used for demos and captures
docs/             AMO listing and release guidance
evals/            Model-backed demo cases and deterministic graders
```

## Pull requests

Explain the user-visible reason for the change and any permission or privacy impact. Build and signing artifacts belong in `web-ext-artifacts/` and stay untracked.

Maintainers should follow [docs/RELEASING.md](docs/RELEASING.md) for Firefox Add-ons submission and signing.

By contributing, you agree that your contribution is licensed under the repository's MIT license.
