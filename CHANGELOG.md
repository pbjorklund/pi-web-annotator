# Changelog

## 2.0.3

- Include versioned release notes in Git and npm packages for Pi 1.5 update notices.
- Reject releases without a nonempty, version-matched changelog entry during package checks and release validation.
- Repair release-toolchain dependencies with fixed undici, fast-uri and minimatch versions, a compatible multimatch update, and a source-verified local deepmerge prototype-poisoning fix. These dependencies are not bundled into the published Pi or Firefox packages.
- Browser behavior, bridge commands, permissions, consent, storage, and data sharing are unchanged.

## 2.0.2

- Move browser and Pi bridge code to strictly checked TypeScript, with readable generated JavaScript and matching source archives for AMO review.
- Validate stored notes and bridge messages, and reject malformed Pi RPC success values. Existing valid notes remain available.
- Permissions, consent, storage locations, and Pi data sharing are unchanged.

Earlier versions are documented in [GitHub releases](https://github.com/pbjorklund/pi-web-annotator/releases). This file does not reconstruct that older history.
