# Compatibility

Herdr Control 0.1.x has been exercised with:

- Node.js 22 and 24. The managed installer requires Node.js 22.5 or newer.
- Node.js 26.8.1 has also passed managed installation, build, and deployed
  read-only browser checks; the latest full unit suite ran on Node.js 24.16.0.
- Herdr 0.8.0 using protocol 19 or 20.
- Linux user services under systemd.
- Chromium on desktop and phone viewports, including 320px width and a
  390 x 430 keyboard-sized viewport. These are browser simulations, not physical
  iPhone validation.

Each Control Host is checked independently. A bridge reporting a Herdr protocol
outside 19-20 is marked incompatible without taking compatible machines
offline. The last compatible snapshot remains visible while a host reconnects.

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
