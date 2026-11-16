# Annotation DOM isolation assessment

## Decision

Treat the on-page overlay as page-readable, page-modifiable UI. Firefox's extension-world separation protects JavaScript state and extension APIs; ordinary DOM controls remain shared with the page.

Recommend a bounded follow-up: move **per-job review and send approval** into extension-owned browser UI. Capture can remain on the page, but page-DOM events must not authorize sending a stored collection. This assessment does not implement or authorize that redesign.

Target: the 2.0.4 source candidate at [86efd63](https://github.com/pbjorklund/pi-web-annotator/tree/86efd63ac30abae8bd745572ec5354b30c31aa06). Runtime code, manifests, permissions and bridge behavior are unchanged. The report and isolated fixture do not establish release, store approval or deployment of the pending runtime candidate.

## Threat model

- **Attacker:** script in a webpage where the user enabled the annotator, including a compromised application page. It controls page DOM, CSS, scripts and requests; it has no extension API, debugger, local-process or filesystem privilege.
- **Assets:** saved annotation text/context, unsaved drafts, collection integrity and the user's decision to submit work. Same-origin collections include notes from other paths.
- **Send preconditions:** a reachable Pi bridge and previously granted Firefox browsing-activity/website-content permissions. The bridge is off by default.
- **Excluded:** production collections, credentials, real Pi/model traffic, model/tool execution, other extensions, hostile local processes, protected Firefox pages, private windows and runtime redesign.

| Boundary | Existing control | Remaining concern |
| --- | --- | --- |
| Page / content-script JavaScript | Firefox Xray/global separation | Shared DOM text, form values and attributes |
| Page / extension storage | Native extension APIs; broker sender-origin checks | Page-induced content-script UI actions |
| Content script / Pi relay | Fresh data-permission check before serialization/fetch | Per-job user approval after an earlier grant |
| Firefox / Pi HTTP listener | Loopback, marker and request validation | Other local clients; model/tool authority |

## Verified native results

Five characterization tests pass on Playwright-managed Firefox 151.0/Linux in disposable regular profiles. Firefox's debugging protocol installs the temporary add-on; native `browser.scripting.executeScript` loads the production scripts. The attack runs in an ordinary page script's network continuation. Induced click/change events have `isTrusted === false`, and transient user activation is false.

| Case | Observed result |
| --- | --- |
| Native worlds and direct API access | Content world has native runtime/storage factory/state; page globals `browser`, `PiWebAnnotatorStorage` and `__piWebAnnotator` are undefined. A fake page namespace and its `destroy()` leave protected state/storage unchanged. |
| Read exposure | Page reads saved row text, current-page pin title, an unsaved textarea draft and another path's same-origin note. The unrelated-origin sentinel and unrendered metadata marker are absent from panel text. |
| Cosmetic tampering | Replacing row text and pin title changes presentation while native memory/storage remain unchanged. |
| Persisted forgery | Script-click Edit, assign textarea value and script-click Save: native storage contains the forged synthetic note, preserving the other row and captured metadata. |
| State/deletion | Script-dispatched checkbox change persists `completed`; script-click Delete removes that row while preserving the other. |
| Send without data permission | Native permission check is false; synthetic row Send opens consent, reaches terminal refusal and admits zero jobs. Storage remains unchanged. |
| Send with native permission present | Fixture-required data permissions make the native check true. Synthetic row Send admits one job to the owned fake bridge with ID `1` and its synthetic note, excluding the other row and unrelated sentinel. |

These show user-level disclosure/state impact after enabling the overlay on a hostile page. Sending also requires a permission grant and reachable bridge. The fake bridge proves HTTP admission, not model execution or tool access. Clear confirmation, clipboard fallback, global shortcuts, batch and save-and-send attacks remain untested.

## Fixture boundary

Run from the repository with the locked dependencies and Playwright Firefox installed:

```bash
node --import tsx --test test/dom-isolation.test.mts
```

`npm test` includes these cases. The runner needs a UNIX-domain socket; verified platform is Linux. Each test creates a fresh profile and owned socket, performs native installation, and removes its browser/profile/servers on completion or setup failure. It never discovers an existing browser. Native snapshot checks explicitly confirm a regular, non-private target.

Fixture-only differences from the copied product:

- Append `fixture.js` to the copied manifest's background scripts. Its unguessable mailbox lets the trusted test controller seed/read native storage and inject scripts; the hostile page receives a separate mailbox.
- Redirect exactly one background bridge endpoint to an owned ephemeral fake server on a different origin from the target. Port17373 is never used. The fake server records requests and returns JSON; no Pi/provider runs.
- In the granted variant only, replace `required: ["none"]` and the optional list with required `browsingActivity`/`websiteContent`. Native `permissions.contains` must return true. This establishes the pre-granted condition, not optional-permission consent UX.

Other copied product artifacts are compared byte-for-byte. Native browser APIs are not replaced with page mocks. Characterization starts green because the exposed behavior is the measured subject. A harmless panel-title copy change passed; replacing rendered notes with a wrong marker failed the note-read assertion. Both temporary mutations were restored.

Existing injected-script UI tests remain logic regressions, not Firefox isolation proof. Passing characterization tests does not mean exposed behaviors were repaired.

## Options and compatibility costs

| Option | Benefit | Remaining risk / cost |
| --- | --- | --- |
| Current UI and warnings | Preserves workflow and accessibility; permissions limit sending before a grant | Accepts page-readable notes and page-controlled UI. Deliberately limiting supported trust assumptions requires an owner decision. |
| Closed Shadow DOM plus trusted-event checks | Could reduce DOM discovery, CSS interference and synthetic activation | Requires review of every note sink, pin title, clipboard fallback and global shortcut. Event retargeting, focus, selection, drag and assistive technology need tests. Trusted clicks on page-positioned UI still need consideration; no prototype is claimed. |
| Extension-owned per-job review/approval | Separates final payload display and approval from page DOM | Adds a review step to row, batch and save-and-send actions, plus snapshot/revision handling. Notes remaining on the page stay exposed; other local HTTP clients remain unauthenticated. |

### Recommended follow-up

1. Show the proposed payload, origin, included pages and selected IDs in a browser-action popup or top-level extension-owned page. An embedded page frame remains susceptible to page positioning. Keep approval unavailable to page DOM and web-accessible resources.
2. Accept approval only from the intended extension-owned UI. Verify its sender and recheck stored rows/revisions before admission. Changed, deleted, stale or cancelled proposals require another review.
3. Retain fresh Firefox permission checks, explicit uncertain-delivery retry and lifetime fences. Approval cannot retract admitted work or authenticate the HTTP listener's other clients.
4. Retain privacy warnings while note-bearing DOM remains on the page. Moving the editor/panel for confidentiality requires a separate design decision.

Later implementation acceptance: native Firefox cases reject page-triggered sends after a grant and reject stale proposals. Preserve intentional keyboard/pointer and accessibility use. Row/batch actions propose the selected scope; save-and-send proposes review after confirmed persistence. Every final send requires extension-owned approval. These are proposed checks, not results of this assessment.

## Limits and counterevidence

- Protected globals, sender-origin checks, disabled-by-default Pi and Firefox permission gates narrow the exposure. This is not an unrestricted storage API escape or proof of code execution.
- A page already controls captured HTML, URLs and text. Trusted review cannot prove their truth or model compliance.
- Missing source event checks alone do not prove reachable native actions.
- Firefox 151.0/Linux does not establish Firefox 140, other platforms, signed installations, store approval, consent UX, clipboard success or live Pi/provider behavior.

## Sources

- [UI, handlers and exports](https://github.com/pbjorklund/pi-web-annotator/blob/86efd63ac30abae8bd745572ec5354b30c31aa06/src/browser/web-annotator.ts): `render`, `commit`, `onKey`, `sendItemsToPi`, `copyText`.
- [Origin validation and relay admission](https://github.com/pbjorklund/pi-web-annotator/blob/86efd63ac30abae8bd745572ec5354b30c31aa06/src/browser/background.ts); [consent](https://github.com/pbjorklund/pi-web-annotator/blob/86efd63ac30abae8bd745572ec5354b30c31aa06/src/browser/consent.ts).
- [MDN: content-script DOM access/Xrays](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#dom_access), reviewed 16 November 2026: shared DOM changes, isolated globals and clean built-ins.
- [MDN: Shadow DOM mode](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM#elementshadowroot_and_the_mode_option), reviewed 16 November 2026: closed mode is not a strong security mechanism. This does not establish a particular plain-page bypass of Firefox extension-created roots.

## Bias review

| Risk | Correction |
| --- | --- |
| Equating DOM exposure with an extension API escape | Include native-world negative controls. |
| Treating source inspection as a native exploit | Require actual installed-extension action results and record fixture variations. |
| Assuming approval UI also protects drafts or local HTTP clients | Limit the recommendation to final approval and retain those exclusions. |

Counterargument: the bridge is off by default, Firefox permissions gate relays, and existing warnings discourage secrets and untrusted pages. Retaining that limited workflow avoids a UI migration. Those controls narrow exposure, but page-controlled events still do not establish per-job intent after a grant; the recommendation targets that boundary.
