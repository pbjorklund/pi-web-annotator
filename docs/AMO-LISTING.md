# Firefox Add-ons listing copy

Use this file when creating or updating the listing in the AMO Developer Hub.

## Name

Web Annotator for Pi

## Summary

Annotate webpage elements or text, send targeted change requests to Pi, or copy them as Markdown.

## Categories

- Web Development

## Compatibility

- Firefox desktop 140 or newer.
- Firefox for Android is unsupported.

## Description

Review a web page without leaving Firefox.

Click an element or select text, write a change request, and collect structured annotations across reloads and page navigation. Copy one note as Markdown, or the whole review as Markdown or JSON for Pi, or send it through the optional local Pi bridge.

With the optional local Pi bridge you can:

- save and queue an annotation in one action;
- send one pending annotation or the whole batch;
- see when work is queued, active, or complete;
- receive completion notifications in the browser.

Same-origin tabs share committed changes through an on-device coordinator. Independent changes are preserved; competing edits and failed saves keep your draft and offer Reload saved recovery. Reload previously enabled tabs after upgrading; older injected writers are unsupported.

The extension has no developer-operated service, analytics, advertising, or account system. Saved annotations use Firefox extension storage. Page scripts cannot directly access that storage, but can inspect or alter notes rendered in the page DOM. Avoid secrets. The background rechecks Firefox data permission before relaying annotation content or stored job IDs to Pi on `127.0.0.1`; denied or unavailable permission refuses these relays without prompting. Health probes carry no annotation text and remain usable without data permission. Admission checks cannot retract requests already sent. With permission and a running bridge, page scripts can trigger on-page send controls without user activation. Firefox consent is not per-job human approval. Pi may then send it to the model provider configured by the user. The extension is unavailable in private windows.

## Release notes for 2.0.4

Require both optional Firefox data permissions before every background annotation send and job-status relay. Refuse missing, revoked, unavailable or invalid permission results before serialization or network admission, without prompting. Health probes remain usable without data permission. No new permissions, network destinations or bridge commands; an admission check cannot retract requests already sent. Fence overlapping sends and stale consent, send, status and setup replies within an overlay. Retire replaced UI and keep retries explicit: teardown cannot undo accepted work, and retrying can duplicate it. Coordinate same-origin collection mutations with revisions and centrally allocated IDs. Preserve independent changes, reject stale edit/delete/Clear conflicts, migrate legacy extension storage with retryable cleanup, and retain drafts with Reload saved recovery after unconfirmed writes. No deleted-note history is retained. Reload all previously enabled tabs after upgrading; older writers are unsupported. Document page-DOM exposure and patch the development Undici toolchain within its existing consumer majors; those dependencies are not shipped in the Firefox or Pi runtime packages.

## Privacy policy

Use the current contents or public URL of `PRIVACY.md`. The [behavior walkthrough](extension-walkthrough.md) documents capture, storage, exports and bridge limits; listing copy must match it and the shipped source.

## Reviewer notes

The extension package contains readable JavaScript generated from TypeScript, without bundling, minification, or remote code. The uploaded matching source ZIP includes `SOURCE.md` with Node.js 24, locked dependency installation, and reconstruction commands. It includes `LICENSE` and `THIRD_PARTY_NOTICES.md` for the upstream MIT-licensed code. On first installation, the background script opens the bundled `welcome.html` page with usage and optional Pi setup instructions. The separate Pi package is a repository resource and is not part of the XPI. The first Pi send opens the bundled `consent.html` page. Its button requests Firefox's optional browsing activity and website content permission. After permission is granted and the user sends again, the extension rechecks both data permissions in the background before sending the annotation to `http://127.0.0.1:17373`. Job-status relays also recheck permission; health remains usable without it. Permission-check failure does not trigger another permission prompt or open a tab. Pi may then send the content to the user's configured model provider. The background also serializes local collection operations by verified sender origin. Schema v2 adds row/collection revisions and an ID counter; migration confirms v2 before emptying the legacy v1 array. Failed loads/writes do not become empty collection saves. Isolated production-broker/two-page fixtures cover concurrency, migration, conflicts and recovery without real Pi or model traffic. This extension supports Firefox desktop only. Firefox for Android is unsupported and excluded from the AMO compatibility metadata.
