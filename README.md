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

- See agents and shells from every configured Herdr machine, grouped by
  repository Project with live status updates.
- Start a configured coding agent in a Project, an existing Worktree, a new
  Worktree, or an existing checkout. Each agent starts in its own Thread.
- Supply an optional title and initial message when starting an agent.
- Follow how long an agent has been working and see the duration of its latest
  completed working period.
- Open and control shells and full-screen agent interfaces without interrupting
  their underlying processes.
- Type, paste text or clipboard images, send modified keys, resize, scroll, and
  open HTTP or HTTPS links from desktop or phone layouts.
- Read completed replies as Markdown and send messages from a native composer,
  without attaching a terminal. Drafts survive navigation and reload. Durable
  send receipts prevent retries from repeating an accepted Control request.
- Observe a terminal controlled by another browser, explicitly take control,
  and recover control after reconnecting.
- Archive threads without stopping their agents, stop agents explicitly, and
  resume supported sessions. The main view shows 7 days of recent history;
  the full archive retains conversations without automatic expiry.
- Choose from eight light and dark themes and customise interface fonts,
  terminal fonts, text sizes, cursor behaviour, and new-thread defaults.

Control discovers Projects and Worktrees from Herdr's repository inventory. To
start a thread from Control, first open a Herdr workspace associated with the
repository. Projects and thread history then remain available even as Herdr's
workspace, tab, and pane layout changes.

Each bridge checks its own executable `PATH` and reports which Control-supported
agents it can launch. New-thread controls use the inventory from the Project's
host, so different Herdr machines can offer different agents.

### Current limitations

- Control has no built-in authentication. Keep the bridge on localhost and use
  a trusted access layer for remote access.
- Thread restoration currently supports Codex, Claude, and Pi, and requires a
  provider reference reported by the corresponding Herdr integration.
- Reply capture currently supports Codex, Claude, and Pi through optional host
  hooks. It captures new completed replies and prompts, not historical transcripts,
  tool activity, or streamed tokens. Other agents remain accessible in the terminal.
- Threads without resumable session references remain readable but cannot resume.
- The browser caches the latest 100 messages and drafts on the device. Reading
  a cached conversation during host disconnection requires the app to be loaded;
  this release does not provide a fully offline app shell.
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
browser conversation + optional xterm.js
        ↕ HTTP/WebSocket
Herdr Control bridge
        ↕ local Herdr CLI/session protocol
Herdr-owned terminal
```

Herdr remains responsible for running processes, terminal ownership, and the
current workspace layout. Control adds browser access and stores stable Project,
Worktree, Thread, and Run metadata, captured messages, and send receipts in SQLite.
Small provider integrations write completed replies to a local spool, which the
bridge imports even after downtime. Control does not store terminal output.

If the Herdr connection drops, Control keeps showing the last known state while
it reconnects. The agents and terminals continue running under Herdr throughout.

Recognised agent panes are adopted automatically. When a resumable agent pane
closes, its current run ends and its thread moves to the archive. Threads without
a session reference are retained too, with resume unavailable. Ordinary shell
panes do not create conversation history.

## Quick start

Requirements:

- Node.js 22.5 or newer
- Herdr 0.8 or newer with terminal session control support
- A running Herdr instance

Clone the repository and install the managed user service:

```bash
git clone https://github.com/gregmcausland/herdr-control.git
cd herdr-control
npm run control -- install
```

Open `http://127.0.0.1:4173`.

The [five-minute walkthrough](docs/getting-started.md) covers naming the Home
bridge, adding another machine, private remote access, and creating a first
Thread. Tested versions are recorded in [compatibility](COMPATIBILITY.md).

The installer builds Control and starts `herdr-control.service` for the current
Linux user. It preserves an existing service's Control environment settings and
does not replace the state database.

Manage the service from the checkout:

```bash
npm run control -- status
npm run control -- logs
npm run control -- update
npm run control -- restart
npm run control -- remove
```

To enable the conversation reader, install capture on each agent host:

```bash
npm run control -- capture-install
```

See [reply capture](docs/reply-capture.md) for supported hooks, activation, custom
state locations, and troubleshooting. Existing agent processes keep running.

Removal stops and removes the user service but keeps configuration and database
files. The managed path currently supports Linux with systemd user services.

Control connects to every saved Control Host and shows their Projects in one
view. Each Project identifies its owning machine.

## Remote access

Keep the bridge bound to localhost and place it behind a trusted access layer.
The currently tested route uses Tailscale Serve:

```bash
tailscale serve 4173
```

Open the HTTPS address printed by Tailscale. Do not bind Control directly to a
public or untrusted network because it does not provide its own authentication.

## Thread restoration

For resumable Codex, Claude, and Pi threads, install Herdr's provider
integrations once on the machine running the agents:

```bash
herdr integration install codex
herdr integration install claude
herdr integration install pi
```

Restoration is offered only after Herdr reports a supported provider session
reference. Archiving removes a thread from the active view and leaves its process
running. Use **Stop agent** in the conversation to request process retirement.
If Herdr must preserve its worktree, Control reports that the process remains alive.

The Project list shows archived Threads for 7 days. The full archive screen
retains Threads and captured messages without automatic expiry, including threads
without a resume reference. Unarchiving a running Thread reuses its existing Run.

## Control Hosts

The bridge serving the browser is the Home bridge. It stores the Control Host
list in its local state database. Use the server button in the header to add,
rename, check, or remove machines. The browser connects to every listed bridge
directly, so each bridge must allow the Home bridge's origin for cross-host
HTTP, SSE, and WebSocket connections.

Older installations can import a previous JSON host list once by setting
`HERDR_CONTROL_LEGACY_HOSTS` to that file before starting the bridge. Current
installs do not bundle any machine names or URLs. See the
[host configuration migration](docs/host-configuration-migration.md) for backup
and recovery details.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HERDR_CONTROL_BIND` | `127.0.0.1` | Bridge bind address |
| `HERDR_CONTROL_PORT` | `4173` | Bridge port |
| `HERDR_CONTROL_BIN` | `herdr` | Herdr executable |
| `HERDR_CONTROL_SOCKET` | Herdr's default socket | Explicit Herdr socket path |
| `HERDR_CONTROL_STATE` | `~/.local/state/herdr-control/control.db` | Durable Control state database |
| `HERDR_CONTROL_LEGACY_HOSTS` | Unset | Optional one-time source for a legacy JSON Control Host list |
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
npm run test:browser:mock
```

The mock browser suite needs Playwright Chromium (`npx playwright install chromium`)
and starts its own client. It does not connect to real agents.

The browser compatibility suite controls a real, isolated Herdr pane and
therefore requires explicit endpoints:

```bash
HERDR_CONTROL_TEST_CLIENT=http://127.0.0.1:5173 \
HERDR_CONTROL_TEST_BRIDGE=http://127.0.0.1:4173 \
HERDR_CONTROL_TEST_PANE=w1:p2 \
npm run test:browser
```
