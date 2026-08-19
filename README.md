# Herdr Control

A minimal browser control surface for existing Herdr panes. Herdr continues to own the PTYs and processes; this project only bridges terminal frames and input over HTTP/WebSocket.

```text
browser + xterm.js
        ↕ HTTP/WebSocket
companion bridge
        ↕ local CLI/socket
Herdr-owned PTY
```

Architecture note: Treat the terminal surface as an isolated pipeline from the
surrounding picker and app shell. Changes should preserve a small hosting seam
so the shell's eventual UI stack can be chosen independently. The current shell
is intentionally provisional; this records direction, not a migration plan.

## Project status

Herdr Control is an early, validated prototype. The terminal path is working:
the browser can discover Herdr panes, render and control them, handle ownership
contention, and reconnect without owning the underlying process.

The current picker and application shell are intentionally basic. The next
stage is to develop the orchestration surface: a clearer interface for seeing
what agents are doing, moving between work, and supervising it without reducing
everything to raw terminal interaction.

See [prototype validation](docs/prototype-validation.md) for the behaviours
tested so far and the remaining browser compatibility caveats.

## Development

Requirements: Node.js 22+ and Herdr 0.8+ with `terminal session control` support.

```bash
npm install
npm run dev
```

The bridge listens on `127.0.0.1:4173`; Vite serves the independent client on `127.0.0.1:5173`. Open the client with a bridge URL:

```text
http://127.0.0.1:5173/?host=http://127.0.0.1:4173
```

The host can also be entered on the picker screen and is remembered by the browser.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERDR_CONTROL_BIND` | `127.0.0.1` | Bridge bind address |
| `HERDR_CONTROL_PORT` | `4173` | Bridge port |
| `HERDR_CONTROL_BIN` | `herdr` | Installed Herdr binary |
| `HERDR_CONTROL_ALLOWED_ORIGINS` | local Vite origins | Comma-separated independent-client origins |

## Built client

```bash
npm run build
npm start
```

The bridge then serves the same browser client at `http://127.0.0.1:4173`. For remote use, keep the bridge on localhost and expose it with Tailscale Serve; the same-origin client works without additional origin configuration.

```bash
tailscale serve 4173
```

Open the HTTPS URL printed by Tailscale. This route carries the static client, snapshot requests, terminal frames, and input over the tailnet. To host the client separately, add its exact origin to `HERDR_CONTROL_ALLOWED_ORIGINS` and point its host field at the bridge's HTTPS URL.

The browser first attempts writable control. When another direct terminal client owns the pane, it can observe or explicitly take control. Taking control disconnects the previous direct client but never stops the Herdr pane or its process.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Live browser checks require an isolated shell pane and a running client/bridge:

```bash
HERDR_CONTROL_TEST_CLIENT=http://127.0.0.1:5173 \
HERDR_CONTROL_TEST_BRIDGE=http://127.0.0.1:4173 \
HERDR_CONTROL_TEST_PANE=w1:p2 \
npm run test:browser
```
