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
- Persist repository Projects and their Worktrees independently of Herdr's
  replaceable workspace layout, while projecting current workspace associations
  from Herdr's own worktree inventory.
- Start a new agent from a Project with an optional existing, new, or attached
  Worktree. Every created agent receives its own Herdr tab, and the resulting
  Thread and Run are adopted from Herdr's next authoritative snapshot. A
  typeahead agent picker can also request the harness's native permission-bypass
  launch mode for Codex, Claude, Gemini, Pi, or OpenCode. Browser-local settings
  provide the default agent and permission choice for each new Thread.
- Adopt recognized agent panes into durable Threads and record each transient
  execution as a Run across bridge restarts.
- Archive agent Threads in Control; retire their live pane when Herdr says it
  is safe, or preserve the protected worktree runtime while following archived
  visuals. Restore supported inactive sessions into a fresh Run when a provider
  reference is available. Threads that have not gained a session reference are
  deleted instead of retained in an archive they could never leave.
- Remove transient shell panes from Control immediately and retire their Herdr
  resources when safe, without turning them into durable Threads.
- Present a stable, workspace-grouped pane overview without moving panes as
  their activity changes.
- Show the live or most recently completed working duration beside each agent's
  status.
- Store browser-local theme, app and terminal fonts, text sizing, terminal cursor,
  default agent, and permission-bypass preferences behind the Settings control.
- Switch the app and terminal together between Dracula, Catppuccin Mocha,
  Tokyo Night, Gruvbox Dark, Nord, Catppuccin Latte, Solarized Light, and
  Gruvbox Light palettes. Light terminals adapt dark true-colour surfaces
  emitted by agent interfaces locally and enforce readable text contrast,
  without changing the shared Herdr process.
- Render and control live shells and full-screen coding-agent interfaces.
- Link to and refresh individual terminal views without losing the selected pane.
- Resize, scroll, type, paste text, and send terminal keys through Herdr's
  keyboard-aware input path, including modified keys such as Shift+Enter.
- Use a phone-friendly message composer and clipboard-image upload.
- Observe a busy pane or explicitly take control from another client.
- Mark completed work as viewed when its terminal is open and visible.
- Release control while backgrounded and reclaim it automatically when the
  browser returns or the bridge reconnects, prompting only when another client
  now owns the terminal.

The interface now has a focused orchestration foundation: workspaces organise
the panes, agent state drives their presentation, and active work has a live
visual treatment. The next stage is to deepen that surface so it becomes easier
to understand what agents are doing, see which work needs attention, navigate
active tasks, and supervise work without treating every interaction as a raw
terminal session. Direct terminal control will remain available as the reliable
underlying escape hatch.

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

- Node.js 22.5 or newer
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
| `HERDR_CONTROL_STATE` | `~/.local/state/herdr-control/control.db` | Durable Thread and Run database |
| `HERDR_CONTROL_ALLOWED_ORIGINS` | Local Vite origins | Comma-separated origins for separately hosted clients |

Recognized agent panes are adopted automatically. Herdr Control stores their
lifecycle metadata and stable identity, not terminal output or reconstructed
conversation transcripts. Restore is offered only when Herdr reports a provider
session reference that Herdr Control knows how to resume. Until an agent exposes
that reference, Control offers Delete instead: the Thread is removed permanently
and never appears in Archived. Plain shell panes remain transient and can be
deleted, but are never archived.

Archiving and plain-pane deletion take effect in Control immediately. Retiring
the associated Herdr pane is asynchronous: a pane protected by Herdr's worktree
guard remains hidden and is retried after terminal topology changes.

Projects, Worktrees, Threads, and Runs are durable Control concepts. Herdr's
workspaces, tabs, panes, terminal IDs, agent status, and worktree-open state are
runtime facts and are reconciled from complete snapshots. Closing a Herdr pane
ends its Run and archives its Thread; closing a workspace ends its Worktree
Runtime without deleting the Project, Worktree, Thread, or Run history.

For resumable Codex, Claude, and Pi Threads, install Herdr's provider
integrations once on the machine running the agents:

```bash
herdr integration install codex
herdr integration install claude
herdr integration install pi
```

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
