# Compatibility

Herdr Control 0.1.x has been exercised with:

- Node.js 22 and 24. The managed installer requires Node.js 22.5 or newer.
- Node.js 26.8.1 has also passed managed installation, build, and deployed
  read-only browser checks; the latest full unit suite ran on Node.js 24.16.0.
- Herdr 0.8.0 using protocol 19 or 20, and Herdr 0.9.0 using protocol 22.
- Linux user services under systemd.
- Chromium on desktop and phone viewports, including 320px width and a
  390 x 430 keyboard-sized viewport. These are browser simulations, not physical
  iPhone validation.

Each Control Host is checked independently. The bridge validates Herdr's JSON
socket snapshots and event subscriptions before publishing them. The browser
trusts that matching bridge instead of treating Herdr's private terminal protocol
number as JSON API compatibility. One reconnecting host does not take the others
offline, and its last valid snapshot remains visible.

Terminal streaming uses Herdr's version-matched private protocol. If an updated
Herdr binary is temporarily paired with an older running server, orchestration
remains available through the JSON socket while the terminal reports the mismatch.
Restart or hand off that server to restore terminal streaming.

The bridge HTTP, SSE, and WebSocket APIs are bundled with the client and versioned
together. Mixed Control client and bridge releases are not a supported public
interface in 0.1.x.

Safari and WebKit remain unverified. The manual installation path can run on
other platforms, but the managed `npm run control -- install` path currently
targets Linux with systemd user services.

Conversation capture uses Codex and Claude `UserPromptSubmit`/`Stop` hooks and Pi's
`message_end`/`agent_settled` extension events in TUI mode. These provider contracts
were checked against upstream documentation on 2026-09-05. Installer, capture,
delivery, and mobile flows have automated fixture coverage. Live Codex prompt
and completed-reply capture was observed on 2026-09-05; a repeatable live hook
matrix across all three installed providers remains outstanding. Older agents
may lack these events. See [reply capture](docs/reply-capture.md) and the dated
[validation record](docs/prototype-validation.md).
