# Privacy policy

Effective: 17 July 2026

Web Annotator for Pi has no developer-operated backend, analytics or advertising. The optional local Pi workflow can pass annotation content onward to Pi's configured model provider, including a remote provider. Firefox opens a bundled welcome page after first installation. That page makes no automatic network requests; its Pi and source links open only when you select them.

## Data kept in Firefox

When you save an annotation, the extension stores a separate collection for that website in Firefox extension storage under a `pi-web-annotator:collection:v1:` key. It also stores the panel's normalized screen placement under `pi-web-annotator:panel-placement:v1` so the panel remains where you moved it after navigation. Collections in website `localStorage` are not imported, changed, or deleted. A saved item can include:

- your note;
- the full page URL, including query and fragment;
- selected text or element `textContent`, which can include hidden descendants;
- element attributes, including custom and literal `value` attributes unless filtered, selectors, source/component hints, position, colors and selected computed styles;
- annotation and Pi job status.

Collections are grouped by origin (scheme, host and port) across pages. Page scripts cannot directly access Firefox extension storage. However, notes appear in ordinary page DOM rows, editor controls and pin titles that the visited page can inspect or alter. This is not a confidential overlay. Capture does not exclude sensitive elements or automatically redact secrets. Do not put secrets in annotations.

Storage writes are asynchronous and failures are not reported in the panel; a visible saved row does not prove durable persistence. Concurrent tabs can overwrite their collection snapshots. Use **Clear** to remove the origin's collection; this does not retract clipboard copies, Pi messages, provider data or edits already made.

The extension is not available in private windows, so it does not save private-browsing annotations. It writes to the clipboard only when you use a copy action or shortcut.

## Optional local Pi bridge

The Pi integration is off unless a Pi annotation server is running on your device. Your first send action opens a bundled extension page that explains the transfer and asks you to grant Firefox's optional browsing activity and website content permission. Return to the annotated page and send again after granting it.

In the regular send flow, a permission check precedes submission of selected notes as Markdown and annotation IDs to `http://127.0.0.1:17373`. JSON export retains more stored fields than this Markdown payload. The mounted overlay also makes health probes and, when connected, stored job-ID status requests without a new send action. The background relay and HTTP server do not independently repeat the send flow's permission check. `127.0.0.1` is the loopback address for the same device. The bridge does not connect to a developer-operated service. Its constant request header is not user authentication; local software able to send it can submit jobs. Stopping the listener or deleting a browser note does not cancel work already delivered to Pi. Pi and any model provider configured in Pi handle the annotation after it leaves Firefox; review their privacy terms and your Pi configuration before sending sensitive material.

## Permissions and browser access

- **Active tab and scripting:** inject and remove the overlay after you use the toolbar button or shortcut.
- **Storage:** save annotation collections and the panel placement preference in Firefox extension storage, isolated from page scripts.
- **Access data for all websites:** lets the extension run on pages where you enable it and restore an enabled overlay after navigation.
- **Optional browsing activity and website content sharing:** requested only when you send annotations to the local Pi bridge.
- **Clipboard access through page APIs:** occurs only after a copy action and does not use a persistent clipboard permission.

Firefox blocks extension injection on protected pages such as `about:` pages, the Firefox Add-ons site, PDFs, and `view-source:` pages.

For the source-grounded capture, export and job lifecycle details, read the [behavior walkthrough](docs/extension-walkthrough.md). These clarifications describe existing behavior; they do not add transmission or permissions.

## Changes and questions

Material privacy changes will be recorded in this file and in release notes. Open an issue at <https://github.com/pbjorklund/pi-web-annotator/issues> for questions.
