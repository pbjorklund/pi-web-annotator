# Demo the annotation workflow

This folder is a safe, local target for browser annotations. It contains only fixture copy and styles, so Pi can work here without reading the repository or a real website.

## Run the live workflow

Open three terminals from the repository root:

```bash
npm run demo:serve
npm run demo:browser
npm run demo:pi
```

The commands serve the page on `127.0.0.1:4173`, open it in a temporary Firefox development profile, and start Pi from this folder with the annotation bridge active.

`demo:pi` uses an ephemeral session, disables inherited context and resource discovery, ignores project-local configuration, and enables only read, edit, and write tools. Pi still uses your configured model provider. Only send the fixture annotations shown in this page.

Try this short storyboard:

1. Annotate the release heading: `Shorten this heading and keep the direct tone.`
2. Switch to text mode and select the sentence about Friday's launch: `Make this deadline easier to scan.`
3. Choose **Send to Pi**.
4. Watch the browser rows move from queued to active to complete.
5. Reload the page to inspect Pi's changes, then clear the annotations.

Stop the page server and browser with `Ctrl+C`. Quit Pi with `Ctrl+C` twice.

## Rebuild screenshots

```bash
npm run screenshots
```

The capture script starts its own local server, launches the installed Chromium binary through Playwright, injects the shipped annotation scripts, and saves four images in `artwork/screenshots/`.

Screenshot capture uses a local Pi bridge simulation so the queued, active, and completed states are repeatable. It does not call a model or claim that Pi edited the page. Use the live workflow when recording real agent work.

## Record the live agent video

```bash
npm run demo:video
```

The Python eval runner performs one end-to-end smoke case:

1. Copy this folder to a temporary workspace.
2. Start Pi in RPC mode with an ephemeral session, low thinking, only read, edit, and write tools, and a path gate that blocks access outside the temporary workspace.
3. Start the real annotation bridge on a temporary loopback port.
4. Use Playwright to annotate the heading and send the request.
5. Render Pi's RPC notifications, tool calls, and final text in a terminal pane beside the browser.
6. Wait for `agent_settled`, verify the file edit, reload the browser, and check the new heading.
7. Encode the full-size MP4 and the animated GIF used in the GitHub README with FFmpeg.

The case uses public fixture text and sends one annotation to your configured model provider. It does not save a Pi session or preserve the temporary workspace. The video omits model reasoning, raw prompts, absolute temporary paths, credentials, and unrelated machine state.

Override the configured model when needed:

```bash
npm run demo:video -- --provider openai-codex --model gpt-5.6
```

This is a smoke demonstration, not a reliability benchmark. Repeated model trials stay out of the default command to limit cost and latency.
