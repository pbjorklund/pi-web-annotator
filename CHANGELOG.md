# Changelog

## 2.0.5

- Remove obsolete version-specific release-validation commands from security runbooks; retain the current release procedure and every backport verification step.
- Remove stale source-candidate wording while preserving browser/store version and review-evidence limits. Refresh reusable AMO release copy for this documentation-only release.
- Browser behavior, storage, permissions, bridge runtime and dependencies are unchanged.

## 2.0.4

- Publish the canonical behavior walkthrough and DOM-isolation assessment. Firefox extension storage is separate from website storage; notes rendered in page DOM remain visible and mutable to page scripts. No runtime DOM-isolation redesign is included.
- Patch the existing development Undici overrides to 7.30.2 and 8.12.4, retaining consumer major versions, SDK pins and verified local security backports. Add offline integrity, redirect/cache/replay and actual SDK dispatcher regressions; no toolchain dependencies enter the Firefox or Pi runtime packages.
- Recheck both optional Firefox data permissions before every background send and job-status relay, not only the regular send UI.
- Refuse denied, revoked, unavailable or invalid permission results before serializing data or fetching; do not prompt or open consent tabs from these relays.
- Keep health probes usable without data permission. Preserve granted requests, explicit consent UI, bridge commands, stored data and permission declarations.
- Cover admission and revocation with synthetic fixtures. A permission check cannot retract requests already sent or authenticate other local HTTP clients.
- Reserve selected rows before consent, skip overlapping claims without queued retries, and allow disjoint rows to progress. Fence late send/status responses to their current row, job and revision.
- Retire destroyed or replaced overlays across setup, polling, consent, sends and delayed UI callbacks. Preserve explicit retry; requests and storage writes already admitted cannot be undone, and retrying can duplicate Pi work.

- Coordinate same-origin collection mutations in the background against fresh storage, preserving independent cross-tab changes and rejecting stale edit/delete/Clear conflicts. Allocate IDs centrally without reuse after deletion or Clear.
- Migrate legacy Firefox collections to revisioned storage with retryable cleanup; do not import website localStorage or retain deleted-note history. Reload all previously enabled tabs after upgrading; mixed old writers are unsupported.
- Confirm persistence before committing visible edits or sending new notes. Keep drafts and show accessible Reload saved recovery after failed/unconfirmed writes; never turn a failed load into an empty overwrite.
- Recheck owned rows after sending-state persistence before constructing the Pi payload, excluding notes another tab deleted. Cover broker, migration, conflicts and save recovery with isolated synthetic two-tab tests.

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
