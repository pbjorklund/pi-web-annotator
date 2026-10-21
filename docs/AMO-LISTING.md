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

Click an element or select text, write a change request, and collect structured annotations across reloads and page navigation. Copy one note or the whole review as Markdown or JSON for Pi, or send it through the optional local Pi bridge.

With the optional local Pi bridge you can:

- save and queue an annotation in one action;
- send one pending annotation or the whole batch;
- see when work is queued, active, or complete;
- receive completion notifications in the browser.

The extension has no developer-operated service, analytics, advertising, or account system. Saved annotations use Firefox extension storage, isolated from page scripts. After Firefox consent and a send action, the extension sends annotation content to Pi on `127.0.0.1`. Pi may then send it to the model provider configured by the user. The extension is unavailable in private windows.

## Release notes for 2.0.2

Move browser and Pi bridge code to strictly checked TypeScript, with matching readable JavaScript and source archives for review. Validate stored notes and bridge messages, and reject malformed Pi RPC success values. Existing valid notes remain available. Permissions, consent, storage locations, and Pi data sharing are unchanged.

## Privacy policy

Use the current contents or public URL of `PRIVACY.md`.

## Reviewer notes

The extension package contains readable JavaScript generated from TypeScript, without bundling, minification, or remote code. The uploaded matching source ZIP includes `SOURCE.md` with Node.js 24, locked dependency installation, and reconstruction commands. It includes `LICENSE` and `THIRD_PARTY_NOTICES.md` for the upstream MIT-licensed code. On first installation, the background script opens the bundled `welcome.html` page with usage and optional Pi setup instructions. The separate Pi package is a repository resource and is not part of the XPI. The first Pi send opens the bundled `consent.html` page. Its button requests Firefox's optional browsing activity and website content permission. After permission is granted and the user sends again, the extension sends the annotation to `http://127.0.0.1:17373`. Pi may then send the content to the user's configured model provider. This extension supports Firefox desktop only. Firefox for Android is unsupported and excluded from the AMO compatibility metadata.
