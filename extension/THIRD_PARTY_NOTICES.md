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
| Pi Coding Agent | Optional host for the Pi extension | MIT | <https://github.com/earendil-works/pi> |

Dependency versions are recorded in `package.json` and `package-lock.json`.
