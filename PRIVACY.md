# Privacy policy

Effective: 17 July 2026

Web Annotator for Pi does not send data to the developer, analytics services, advertising services, or other remote servers. Firefox opens a bundled welcome page after first installation. That page makes no automatic network requests; its Pi and source links open only when you select them.

## Data kept in Firefox

When you save an annotation, the extension stores a separate collection for that website in Firefox extension storage under a `pi-web-annotator:collection:v1:` key. Earlier development versions used the website's `localStorage`; those collections are moved to extension storage automatically. A saved item can include:

- your note;
- the page URL;
- selected or nearby page text;
- element attributes, selectors, position, and a small set of computed styles;
- annotation and Pi job status.

This keeps collections available across reloads and navigation on the same site while preventing page scripts from reading or changing saved notes. Do not put secrets in annotations. Use **Clear** in the panel to remove a collection.

The extension is not available in private windows, so it does not save private-browsing annotations. It writes to the clipboard only when you use a copy action or shortcut.

## Optional local Pi bridge

The Pi integration is off unless a Pi annotation server is running on your device. Your first send action opens a bundled extension page that explains the transfer and asks you to grant Firefox's optional browsing activity and website content permission. Return to the annotated page and send again after granting it.

After consent and a send action, the extension sends the selected annotations to `http://127.0.0.1:17373`. The payload can include the data listed above. `127.0.0.1` is the loopback address for the same device. The bridge does not connect to a developer-operated service. Pi and any model provider configured in Pi handle the annotation after it leaves Firefox; review their privacy terms and your Pi configuration before sending sensitive material.

## Permissions and browser access

- **Active tab and scripting:** inject and remove the overlay after you use the toolbar button or shortcut.
- **Storage:** save annotation collections in Firefox extension storage, isolated from page scripts.
- **Access data for all websites:** lets the extension run on pages where you enable it and restore an enabled overlay after navigation.
- **Optional browsing activity and website content sharing:** requested only when you send annotations to the local Pi bridge.
- **Clipboard access through page APIs:** occurs only after a copy action and does not use a persistent clipboard permission.

Firefox blocks extension injection on protected pages such as `about:` pages, the Firefox Add-ons site, PDFs, and `view-source:` pages.

## Changes and questions

Material privacy changes will be recorded in this file and in release notes. Open an issue at <https://github.com/pbjorklund/pi-web-annotator/issues> for questions.
