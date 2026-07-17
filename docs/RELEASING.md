# Release to Firefox Add-ons

Mozilla requires extensions installed in release and beta Firefox to be signed. This repository uses `web-ext` for validation, packaging, and listed AMO submission.

## First release checks

Before submitting version 1.6.0:

- [ ] Make the GitHub repository public so the homepage, support, privacy, and source links work.
- [ ] Confirm the stable extension ID in `extension/manifest.json`. Never change it after publication.
- [ ] Keep AMO compatibility limited to Firefox desktop. Firefox for Android is unsupported.
- [ ] Review `amo-metadata.json`, `PRIVACY.md`, and `docs/AMO-LISTING.md` against the shipped behavior.
- [ ] Run the package gate and inspect the resulting ZIP.

## Build and verify locally

```bash
npm ci
npm run package
npm audit
unzip -l web-ext-artifacts/pi-web-annotator-<version>.zip
```

The package gate runs tests, treats Firefox lint warnings as errors, and writes the unsigned review artifact to `web-ext-artifacts/`.

The ZIP must contain only these twelve readable files from `extension/`:

```text
annotation-storage.js
background.js
consent.html
consent.js
icon-16.png
icon-48.png
icon.png
LICENSE
manifest.json
THIRD_PARTY_NOTICES.md
web-annotator.js
welcome.html
```

The shipped source is not bundled, transpiled, minified, or generated, so Mozilla does not require a separate source archive. Repository scripts, tests, and the Pi package are not included in the Firefox artifact.

## Submit for signing

Create the ignored local credentials file, add the two AMO values, then sign:

```bash
cp .env.example .env
$EDITOR .env
npm run sign:listed
```

The signing command loads `.env` when present. Existing shell variables take precedence, so the GitHub Actions workflow continues to use repository secrets.

The command submits a listed version and returns without waiting for manual approval. Signed files are written to `web-ext-artifacts/` when available.

Alternatively, run the **Release to Firefox Add-ons** GitHub Actions workflow. It validates the package, submits it with repository secrets, and uploads the signing artifacts for inspection.

## Complete the AMO listing

After the first API submission, open the add-on in the AMO Developer Hub:

- [ ] Paste the current privacy policy from `PRIVACY.md`.
- [ ] Set the support email and public GitHub issues URL.
- [ ] Confirm Firefox desktop as the only supported platform.
- [ ] Review the rendered listing and reviewer notes.
- [ ] Respond to any reviewer questions.

## Version checklist

For every later release:

1. Update the version in `package.json` and `extension/manifest.json`.
2. Update the release notes in `amo-metadata.json` and `docs/AMO-LISTING.md`.
3. Run `npm install --package-lock-only` so `package-lock.json` matches.
4. Update `PRIVACY.md` when storage, permissions, or transmission changes.
5. Run `npm run package` and `npm audit`.
6. Inspect the ZIP and confirm it contains only the twelve expected extension files, including `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `welcome.html`.
7. Commit and tag the release as `v<version>`.
8. Submit the listed version and update manual AMO fields when needed.

## Mozilla references

- <https://extensionworkshop.com/documentation/publish/submitting-an-add-on/>
- <https://extensionworkshop.com/documentation/publish/add-on-policies/>
- <https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/>
- <https://extensionworkshop.com/documentation/publish/source-code-submission/>
- <https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/>
