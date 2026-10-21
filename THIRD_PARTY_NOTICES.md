# Third-party notices

This project contains code adapted from another open-source project. It also uses development and host tools that are not included in the Firefox extension package.

## Code included in this project

### browser-annotations

Web Annotator for Pi began as a port of [kuzmany/browser-annotations](https://github.com/kuzmany/browser-annotations). The current project retains portions of the original annotation overlay and builds on its product idea and interface.

- Copyright: Copyright (c) 2026 Zdeno Kuzmany
- License: MIT
- Source: <https://github.com/kuzmany/browser-annotations>

The upstream copyright notice and MIT license are preserved in `LICENSE`. The Firefox package includes the same license as `extension/LICENSE`. Later modifications and new work are Copyright (c) 2026 Patrik Björklund and are released under the same MIT license.

## Tools not included in the Firefox package

These direct tools are used to develop, test, package, or host integrations. Their code and transitive dependencies are not copied into the Firefox extension ZIP.

| Tool | Role | License | Source |
| --- | --- | --- | --- |
| web-ext | Firefox validation, packaging, and signing | MPL-2.0 | <https://github.com/mozilla/web-ext> |
| Playwright | Repeatable demo interaction and screenshot capture | Apache-2.0 | <https://github.com/microsoft/playwright> |
| FFmpeg | Demo video encoding | GPL-3.0-or-later | <https://ffmpeg.org/> |
| Pi Coding Agent | Optional host for the Pi extension | MIT | <https://github.com/earendil-works/pi> |
| TypeScript | Static checks and deterministic JavaScript emission | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| ESLint | Type-aware lint enforcement | MIT | <https://github.com/eslint/eslint> |
| typescript-eslint | TypeScript parser and unsafe-operation lint rules | MIT | <https://github.com/typescript-eslint/typescript-eslint> |
| tsx | Run TypeScript tests and build tooling | MIT | <https://github.com/privatenumber/tsx> |
| jiti | Load TypeScript ESLint configuration | MIT | <https://github.com/unjs/jiti> |
| Node.js types | Check Node-based implementation and tooling | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node> |
| Pi AI | SDK types for PI integration checks | MIT | <https://github.com/earendil-works/pi/tree/main/packages/ai> |
| Pi TUI | Terminal components for Pi bridge tests and the Pi host | MIT | <https://github.com/earendil-works/pi/tree/main/packages/tui> |

Dependency versions are recorded in `package.json` and `package-lock.json`.

### Local node-forge development backport

The repository vendors the Node source of node-forge 1.4.0 with the RSA parser fix proposed in upstream PR 1152, pinned to commit `ceba34402e329f0365134f23fe19898756527d65`. The custom build is `1.4.0-pi.1`, not an official upstream release. It is used only by the development toolchain and is excluded from both published packages.

- Copyright: Digital Bazaar, Inc. and the node-forge contributors, preserved in the source files.
- License: BSD-3-Clause OR GPL-2.0, preserved in `vendor/node-forge/LICENSE`.
- Source: <https://github.com/digitalbazaar/forge>
- Patch: <https://github.com/digitalbazaar/forge/pull/1152>

See `docs/SECURITY-BACKPORT.md` for signed-source provenance, reproducibility checks, exploit tests and audit coverage limits.
