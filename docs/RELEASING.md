# Release the Firefox add-on and Pi package

A published GitHub Release is the release command. It creates the version tag, publishes the Pi package to npm, stores the unsigned review package, and triggers listed submission to Firefox Add-ons.

Do not publish a release until the security gate, package gate, and listing review pass.

## One-time GitHub setup

Add these repository secrets:

- `WEB_EXT_API_KEY`
- `WEB_EXT_API_SECRET`

The release workflow reads only those two AMO credentials. Keep the local `.env` ignored.

After the first npm version exists, configure npm trusted publishing for `pi-web-annotator`:

- provider: GitHub Actions;
- organization or user: `pbjorklund`;
- repository: `pi-web-annotator`;
- workflow filename: `release.yml`;
- allowed action: `npm publish`.

Do not add an npm token to GitHub. Trusted publishing uses short-lived OIDC credentials and adds npm provenance. In the npm package settings, require two-factor authentication and disallow token-based publishing after the trusted publisher succeeds once.

## Prepare a version

1. Update `version` in `package.json` and `extension/manifest.json`.
2. Run `npm install --package-lock-only` so `package-lock.json` matches.
3. Update release notes in `amo-metadata.json` and `docs/AMO-LISTING.md`.
4. Update `PRIVACY.md` when storage, permissions, or transmission changed.
5. Review the AMO metadata and privacy text against the shipped behavior.
6. Run the local gate:

```bash
npm ci
npm run package
npm audit
npm audit signatures
npm run release:validate -- v<version>
unzip -l web-ext-artifacts/pi-web-annotator-<version>.zip
```

The ZIP must contain these twelve readable files:

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

Commit and push the prepared version to `main`. Do not create the tag separately.

## Publish the GitHub Release

Create a draft release from `main`. The `v<version>` tag must match both package versions.

```bash
gh release create v<version> \
  --repo pbjorklund/pi-web-annotator \
  --target main \
  --title "v<version>" \
  --generate-notes \
  --draft
```

Review the generated notes, then publish the draft in GitHub. The `release.published` event starts `.github/workflows/release.yml`.

The workflow:

1. checks out the release tag;
2. rejects a tag that differs from `package.json` or `extension/manifest.json`;
3. runs tests, Firefox lint, and the package build;
4. publishes the Pi package to npm with OIDC and provenance;
5. attaches the unsigned ZIP to the GitHub Release;
6. submits the listed version to Firefox Add-ons;
7. attaches a signed XPI when AMO returns one immediately;
8. preserves all signing artifacts in the workflow run.

Prereleases do not submit to AMO.

Check the run before announcing the release:

```bash
gh run list --repo pbjorklund/pi-web-annotator --workflow release.yml --limit 5
gh release view v<version> --repo pbjorklund/pi-web-annotator
npm view pi-web-annotator@<version> version
```

AMO review can continue after the workflow finishes. The unsigned ZIP on GitHub is a review artifact, not an installable release for normal Firefox users.

## Local signing fallback

Use local signing only to diagnose release automation or recover from a GitHub outage:

```bash
npm run sign:listed
```

The command reads the ignored `.env`, submits the listed version, and returns without waiting for AMO approval. Do not submit the same version again after GitHub has already accepted it.

## Complete the first AMO listing

After the first accepted submission:

- paste the current `PRIVACY.md` into the listing;
- set the support email and GitHub issues URL;
- confirm Firefox desktop as the only supported platform;
- review the rendered description and reviewer notes;
- respond to AMO review questions.

## Mozilla references

- <https://extensionworkshop.com/documentation/publish/submitting-an-add-on/>
- <https://extensionworkshop.com/documentation/publish/add-on-policies/>
- <https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/>
- <https://extensionworkshop.com/documentation/publish/source-code-submission/>
