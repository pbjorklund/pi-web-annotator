# Repository guidance

## Living behavior specification

Read `docs/extension-walkthrough.md` alongside README and relevant source before changes. Keep it as the canonical behavior overview; update it in the same delivery when capture, storage, exports, commands, permissions, bridge lifecycle or privacy changes. Record the reviewed revision and distinguish runtime guarantees, worker instructions, synthetic tests and live evidence. Keep README concise and retain detailed privacy, demo, release and security procedures as linked references. Review storage isolation separately from rendered DOM exposure, and lifecycle status separately from verified source changes. If behavior is unchanged, verify that explicitly in review.

## Product documentation and marketing

Keep `README.md` and the companion pbcms page at `../pbcms/src/content/projects/pi-web-annotator/index.md` accurate when a change affects public behavior, setup, permissions, privacy, browser support, the Pi bridge, or project status.

Keep the facts aligned, not the copy. `README.md` owns installation, configuration, development, and contributor instructions. The pbcms page presents the problem, value, key strengths, visuals, and destination links. Do not copy command sequences or development procedures into the pbcms page.

When you create or replace a marketing artifact such as a screenshot, GIF, video, poster, badge, add-on listing, or release description, update the relevant `README.md` and package metadata references plus the pbcms page or its assets in the same work. The published page is `/projects/pi-web-annotator`.

Verify public claims against the current extension, package, tests, and store status. If the sibling pbcms checkout is unavailable, name the required page update in the completion report instead of claiming the documentation is complete.
