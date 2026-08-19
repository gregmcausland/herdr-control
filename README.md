# Herdr Control

Herdr Control is an experimental browser interface for
[Herdr](https://herdr.dev), a terminal workspace manager for AI coding agents.

Herdr keeps agents, shells, and other terminal programs running in persistent
workspaces. Herdr Control makes those workspaces accessible from a desktop or
phone browser, so you can check running work, move between panes, and interact
with a terminal without relocating or restarting its process.

This is not a hosted terminal service. A small companion bridge runs beside
Herdr and connects the browser to terminals that Herdr already owns.

## Project status

Herdr Control is an early public prototype. The core terminal path has been
validated, but the interface and protocol may still change.

Working today:

- Discover Herdr workspaces, tabs, and panes.
- Keep workspace and agent state live through Herdr's socket event stream.
- Render and control live shells and full-screen coding-agent interfaces.
- Resize, scroll, type, paste text, and send common terminal keys.
- Use a phone-friendly message composer and clipboard-image upload.
- Observe a busy pane or explicitly take control from another client.
- Disconnect and reconnect without stopping the underlying process.

The current pane picker is deliberately basic. The next stage is an
orchestration-focused interface that makes it easier to understand what agents
are doing, see which work needs attention, navigate active tasks, and supervise
work without treating every interaction as a raw terminal session. Direct
terminal control will remain available as the reliable underlying escape hatch.

See [prototype validation](docs/prototype-validation.md) for the behaviours
tested so far and known compatibility gaps.

## How it works

```text
browser + xterm.js
        ↕ HTTP/WebSocket
Herdr Control bridge
        ↕ local Herdr CLI/session protocol
Herdr-owned terminal
```

Herdr remains responsible for processes and terminal ownership. Herdr Control
is a narrow browser-facing bridge and UI, which keeps the terminal path separate
from the evolving orchestration experience around it.

The bridge bootstraps an authoritative session snapshot, then uses Herdr
lifecycle and agent-status events to trigger coalesced snapshot refreshes. This
keeps the browser live without relying on cross-event ordering. If the Herdr
connection drops, the UI retains the last known state as stale while the bridge
reconnects and resynchronises.

## Run locally

Requirements:

- Node.js 22 or newer
- Herdr 0.8 or newer with terminal session control support

Install dependencies and start the development bridge and client:

```bash
npm install
npm run dev
```

The bridge listens on `127.0.0.1:4173` and Vite serves the client on
`127.0.0.1:5173`. Open:

```text
http://127.0.0.1:5173/?host=http://127.0.0.1:4173
```

The bridge address can also be entered in the UI and is remembered by the
browser.

## Run the production build

```bash
npm run build
npm start
```

The bridge serves the built client at `http://127.0.0.1:4173`.

For remote access, keep the bridge bound to localhost and place it behind a
trusted access layer. The current tested route uses Tailscale Serve:

```bash
tailscale serve 4173
```

Open the HTTPS address printed by Tailscale. Herdr Control does not currently
provide its own authentication, so it should not be bound directly to a public
or untrusted network.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERDR_CONTROL_BIND` | `127.0.0.1` | Bridge bind address |
| `HERDR_CONTROL_PORT` | `4173` | Bridge port |
| `HERDR_CONTROL_BIN` | `herdr` | Herdr executable |
| `HERDR_CONTROL_SOCKET` | Herdr's default socket | Explicit Herdr socket path |
| `HERDR_CONTROL_ALLOWED_ORIGINS` | Local Vite origins | Comma-separated origins for separately hosted clients |

## Verification

Run the local checks with:

```bash
npm run typecheck
npm test
npm run build
```

The browser compatibility suite controls a real, isolated Herdr pane and
therefore requires explicit endpoints:

```bash
HERDR_CONTROL_TEST_CLIENT=http://127.0.0.1:5173 \
HERDR_CONTROL_TEST_BRIDGE=http://127.0.0.1:4173 \
HERDR_CONTROL_TEST_PANE=w1:p2 \
npm run test:browser
```
