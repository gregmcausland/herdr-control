# Herdr Control

Herdr Control is an experimental browser interface for supervising AI coding
agents running in [Herdr](https://herdr.dev), a terminal workspace manager.

It groups active work by repository, shows which agents are working or waiting,
lets you start and revisit agent threads, and keeps full terminal control
available when you need it. The interface works on desktop and phone browsers.

Agents continue running on your machine under Herdr. Control adds a small local
browser bridge; it is not a hosted terminal service and does not move or restart
the processes Herdr owns.

## Project status

Herdr Control is an early public prototype. The main terminal and agent
supervision paths work, but the interface and its integration with Herdr may
still change.

### What you can do

- See agents and shells grouped by repository Project, with live status updates
  from Herdr.
- Start a configured coding agent in a Project, an existing Worktree, a new
  Worktree, or an existing checkout. Each agent receives its own Herdr tab.
- Supply an optional title and initial message when starting an agent.
- Follow how long an agent has been working and see the duration of its latest
  completed working period.
- Open and control shells and full-screen agent interfaces without interrupting
  their underlying processes.
- Type, paste text or clipboard images, send modified keys, resize, and scroll
  from desktop or phone layouts.
- Observe a terminal controlled by another browser, explicitly take control,
  and recover control after reconnecting.
- Archive agent threads and restore supported conversations when Herdr has
  captured a resumable session reference.
- Choose from eight light and dark themes and customise interface fonts,
  terminal fonts, text sizes, cursor behaviour, and new-thread defaults.

Control discovers Projects and Worktrees from Herdr's repository inventory. To
start a thread from Control, first open a Herdr workspace associated with the
repository. Projects and thread history then remain available even as Herdr's
workspace, tab, and pane layout changes.

### Current limitations

- Control has no built-in authentication. Keep the bridge on localhost and use
  a trusted access layer for remote access.
- Session restoration currently supports Codex, Claude, and Pi, and requires a
  session reference reported by the corresponding Herdr integration.
- A thread that ends before gaining a resumable session reference cannot be
  restored and is removed rather than placed in the archive.
- Chromium desktop and a phone-sized Chromium viewport have been validated.
  Safari and WebKit compatibility remain unverified.
- The permission-bypass option gives supported agents substantially more
  autonomy. Use it only in projects and environments you trust.

See [prototype validation](docs/prototype-validation.md) for the behaviours
examined so far and known compatibility gaps. Before upgrading Herdr, an agent
harness, Node.js, xterm.js, or the deployment environment, check the
[external seam maintenance guide](docs/maintenance.md).

## How it works

```text
browser + xterm.js
        ↕ HTTP/WebSocket
Herdr Control bridge
        ↕ local Herdr CLI/session protocol
Herdr-owned terminal
```

Herdr remains responsible for running processes, terminal ownership, and the
current workspace layout. Control adds browser access and stores stable Project,
Worktree, Thread, and Run metadata. It does not store terminal output or
reconstruct conversation transcripts.

If the Herdr connection drops, Control keeps showing the last known state while
it reconnects. The agents and terminals continue running under Herdr throughout.

Recognised agent panes are adopted automatically. When a resumable agent pane
closes, its current run ends and its thread moves to the archive. Agent threads
without a session reference and ordinary shell panes are not retained as
restorable history.

## Quick start

Requirements:

- Node.js 22.5 or newer
- Herdr 0.8 or newer with terminal session control support
- A running Herdr instance

Install dependencies, build the client and bridge, then start Control:

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4173`.

The bridge address can also be entered in the Connection panel and is remembered
by the browser.

## Remote access

Keep the bridge bound to localhost and place it behind a trusted access layer.
The currently tested route uses Tailscale Serve:

```bash
tailscale serve 4173
```

Open the HTTPS address printed by Tailscale. Do not bind Control directly to a
public or untrusted network because it does not provide its own authentication.

## Session restoration

For resumable Codex, Claude, and Pi threads, install Herdr's provider
integrations once on the machine running the agents:

```bash
herdr integration install codex
herdr integration install claude
herdr integration install pi
```

Restoration is offered only after Herdr reports a supported provider session
reference. A thread leaves the active view immediately when archived, even if
Herdr must wait for its worktree before safely retiring the pane.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERDR_CONTROL_BIND` | `127.0.0.1` | Bridge bind address |
| `HERDR_CONTROL_PORT` | `4173` | Bridge port |
| `HERDR_CONTROL_BIN` | `herdr` | Herdr executable |
| `HERDR_CONTROL_SOCKET` | Herdr's default socket | Explicit Herdr socket path |
| `HERDR_CONTROL_STATE` | `~/.local/state/herdr-control/control.db` | Durable Control state database |
| `HERDR_CONTROL_ALLOWED_ORIGINS` | Local Control and Vite origins | Comma-separated origins for separately hosted clients |

## Development

Start the bridge and Vite development server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/?host=http://127.0.0.1:4173
```

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
