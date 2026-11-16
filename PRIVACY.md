# Privacy policy

Effective: 17 July 2026

Web Annotator for Pi has no developer-operated backend, analytics or advertising. The optional local Pi workflow can pass annotation content onward to Pi's configured model provider, including a remote provider. Firefox opens a bundled welcome page after first installation. That page makes no automatic network requests; its Pi and source links open only when you select them.

## Data kept in Firefox

The reviewed 2.0.4 candidate stores a separate collection for each website in Firefox extension storage under a `pi-web-annotator:collection:v2:` key. Version 2.0.3 uses `pi-web-annotator:collection:v1:` arrays. On first access, the candidate confirms the new collection before emptying its legacy array; interrupted cleanup is retried without reimporting old notes. The new envelope stores collection/row revisions and an increasing ID counter, not deleted-note history. It also stores the panel's normalized screen placement under `pi-web-annotator:panel-placement:v1` so the panel remains where you moved it after navigation. Collections in website `localStorage` are not imported, changed, or deleted. A saved item can include:

- your note;
- the full page URL, including query and fragment;
- selected text or element `textContent`, which can include hidden descendants;
- element attributes, including custom and literal `value` attributes unless filtered, selectors, source/component hints, position, colors and selected computed styles;
- annotation and Pi job status.

Collections are grouped by origin (scheme, host and port) across pages. Page scripts cannot directly access Firefox extension storage. However, notes appear in ordinary page DOM rows, editor controls and pin titles that the visited page can inspect or alter. This is not a confidential overlay. Capture does not exclude sensitive elements or automatically redact secrets. Do not put secrets in annotations.

In the candidate, an on-device background coordinator serializes same-origin mutations against fresh stored data and publishes committed changes to enabled tabs. Independent changes are preserved; stale edits, deletes and Clear operations report conflicts. Save waits for storage confirmation. Failed or unconfirmed saves retain the editor draft and require **Reload saved** before more changes; a lost reply can mean a write committed, so inspect the saved collection before explicitly retrying. Older injected writers are unsupported: reload all previously enabled tabs after upgrading.

**Clear** removes saved annotations, not the origin key, revision/ID counters or panel placement. Delete removes one saved annotation. Unsaved drafts in other tabs remain in memory until dismissed or the page closes. Neither action retracts clipboard copies, Pi messages, provider data, edits already made or writes already admitted. Panel-placement failures remain silent.

The extension is not available in private windows, so it does not save private-browsing annotations. It writes to the clipboard only when you use a copy action or shortcut.

## Optional local Pi bridge

The Pi integration is off unless a Pi annotation server is running on your device. Your first send action opens a bundled extension page that explains the transfer and asks you to grant Firefox's optional browsing activity and website content permission. Return to the annotated page and send again after granting it.

The regular send flow checks permission, and the background independently rechecks both Firefox data permissions before every annotation send and stored job-ID status relay to `http://127.0.0.1:17373`. Missing, revoked, unavailable or invalid permission results refuse these relays before data serialization or network admission; the relays do not prompt or open consent tabs. JSON export retains more stored fields than the Markdown send payload. The mounted overlay still makes permission-independent health probes carrying no annotation text. A permission check cannot retract a request already sent. The HTTP server does not verify Firefox consent or authenticate other local clients. `127.0.0.1` is the loopback address for the same device. The bridge does not connect to a developer-operated service. Its constant request header is not user authentication; local software able to send it can submit jobs. Stopping the listener or deleting a browser note does not cancel work already delivered to Pi. Pi and any model provider configured in Pi handle the annotation after it leaves Firefox; review their privacy terms and your Pi configuration before sending sensitive material.

An overlay reserves selected rows while consent is checked. Clear, Delete, manual status changes or turning off the overlay can invalidate an unsent selection, but cannot cancel requests, Pi work or storage writes already admitted. A failed or timed-out reply can mean Pi received the request; inspect Pi before explicitly retrying to avoid duplicate work.

## Permissions and browser access

- **Active tab and scripting:** inject and remove the overlay after you use the toolbar button or shortcut.
- **Storage:** save annotation collections and the panel placement preference in Firefox extension storage, isolated from page scripts.
- **Access data for all websites:** lets the extension run on pages where you enable it and restore an enabled overlay after navigation.
- **Optional browsing activity and website content sharing:** requested only when you send annotations to the local Pi bridge.
- **Clipboard access through page APIs:** occurs only after a copy action and does not use a persistent clipboard permission.

Firefox blocks extension injection on protected pages such as `about:` pages, the Firefox Add-ons site, PDFs, and `view-source:` pages.

For the source-grounded capture, export and job lifecycle details, read the [behavior walkthrough](docs/extension-walkthrough.md). These source clarifications include the reviewed 2.0.4 candidate's browser-relay permission checks and send/lifecycle fences, and cross-tab storage coordination, including revision/ID metadata. They add no network destination or Firefox permission. Source review does not establish publication or the version loaded by an installed browser.

## Changes and questions

Material privacy changes will be recorded in this file and in release notes. Open an issue at <https://github.com/pbjorklund/pi-web-annotator/issues> for questions.
