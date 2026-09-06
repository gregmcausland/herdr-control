# External seam maintenance

Herdr Control keeps its own domain model small and treats Herdr as
the authority for live runtime state. That makes the application simple, but it
also means several upstream interfaces can break Control when their behaviour or
shape changes.

Use this document when upgrading Herdr, an agent harness, Node.js, xterm.js, or
the browser/deployment environment. It records what Control relies on, where the
adapter lives, likely failure symptoms, and which tests to run.

Last reviewed: 2026-09-05. Deployments use Herdr 0.8.0, protocols 19-20, and
Node.js 24.16.0 or 26.8.1. See [validation](prototype-validation.md) for scope. The project
supports Node.js 22.5 or newer; JavaScript dependency versions remain pinned by
`package-lock.json`.

## Maintenance rules

1. Herdr snapshots remain authoritative for workspaces, tabs, panes, agents,
   terminal ownership, status, and open Worktrees. Never repair runtime drift by
   inventing those facts in Control's database.
2. Keep upstream knowledge inside the existing adapters. Herdr response shapes
   and translation belong in `src/server/herdr-protocol.ts`; socket and CLI
   transport belong in `src/server/herdr-socket.ts` and `src/server/herdr.ts`.
   Agent terminal colour compatibility belongs in
   `src/client/terminal-color-adapter.ts`.
3. An event is an invalidation signal, not state. After any relevant event,
   Control reads a complete snapshot and reconciles that snapshot.
4. Add or update a contract test whenever an upstream response, error code,
   command, flag, or terminal sequence changes. Update the baseline above after
   completing the live checks.

## Compatibility map

| External seam | What Control relies on | Main adapter | Primary verification |
| --- | --- | --- | --- |
| Herdr local socket | Snapshot, worktree inventory, lifecycle events, pane and agent actions | `src/server/herdr-socket.ts`, `src/server/herdr.ts`, `src/server/herdr-protocol.ts` | `src/server/herdr-protocol.test.ts`, `src/server/herdr.test.ts` |
| Herdr terminal command | NDJSON terminal frames and input, ownership, observe/control/takeover | `src/server/herdr.ts`, `src/server/herdr-protocol.ts` | `src/server/herdr-protocol.test.ts`, `tests/browser/prototype.spec.ts`, `controller.spec.ts`, `scroll.spec.ts` |
| Agent harnesses and Herdr integrations | Agent detection, status, session references, resume and permission flags | `src/server/herdr.ts`, `src/server/herdr-protocol.ts`, `src/server/threads.ts` | `src/server/herdr-protocol.test.ts`, `src/server/herdr.test.ts`, `threads.test.ts`, `tests/browser/agent-compat.spec.ts` |
| Agent ANSI output | SGR parsing and light-theme remapping for dark true-colour TUI surfaces | `src/client/terminal-color-adapter.ts` | `src/client/terminal-color-adapter.test.ts`, `tests/browser/theme.spec.ts` |
| xterm.js | Terminal rendering, fit, input, paste, selection, resize, theme and contrast controls | `src/client/TerminalView.tsx`, `terminal-input.ts` | Browser suites under `tests/browser/` |
| Browser platform | WebSocket, EventSource, Clipboard, page lifecycle, Visual Viewport, Pointer Events, Canvas | `src/client/` | Chromium browser suite plus focused manual mobile check |
| Voice input | Browser MediaRecorder, Web Audio analysis and OpenAI file transcription | `src/client/use-dictation.ts`, `src/client/VoiceWaveform.tsx`, `src/server/transcription.ts` | `src/server/transcription.test.ts`, `src/server/server.test.ts`, voice input cases in `tests/browser/conversation.spec.ts`; [live trial](voice-input.md) |
| Node.js and SQLite | `node:sqlite` `DatabaseSync`, WAL, foreign keys, filesystem permissions | `src/server/threads.ts`, `clipboard-image.ts` | Unit suite plus opening a copy of production state |
| Reverse proxy/access layer | WebSocket upgrade, unbuffered SSE, allowed origins, HTTPS clipboard access | `src/server/server.ts`, `config.ts` | Remote browser smoke test through the deployed URL |

## Herdr socket contract

The bridge speaks Herdr's newline-delimited JSON socket protocol directly. Each
request is one JSON object terminated by a newline, with `id`, `method`, and
`params`. Responses must preserve the matching response shape and structured
`error.code` values. Requests time out after five seconds and individual lines
are limited to 16 MiB.

### Authoritative reads

Control currently calls:

- `session.snapshot`, expecting `result.snapshot` with complete `workspaces`,
  `tabs`, and `panes` arrays. Agent records and terminal/workspace identifiers
  are reconciled from this structure. The adaptation module validates required
  fields throughout each record before the snapshot can reach reconciliation.
- `worktree.list`, selected by `workspace_id` or `cwd`, expecting `result.source`
  plus a complete `result.worktrees` array. Source fields are `repo_key`,
  `repo_name`, `repo_root`, and `source_checkout_path`. Each Worktree requires
  `path`, `label`, `is_bare`, `is_detached`, `is_linked_worktree`, and
  `is_prunable`.

A malformed or partial Worktree inventory is discarded in full. This is
intentional: accepting a partial inventory could incorrectly mark a durable
Worktree as removed.

### Event subscriptions

The primary subscription follows workspace, worktree, tab, pane, and layout
lifecycle events listed in `LIFECYCLE_SUBSCRIPTIONS`. Each current pane also has
a scoped `pane.agent_status_changed` subscription. Control only requires each
event record to contain an `event` string and object-shaped `data`; it then
refreshes the complete snapshot.

If Herdr renames an event, changes subscription filtering, or begins emitting
status globally, update the subscription adapter and its tests. Typical symptoms
are a UI that becomes correct only after a refresh, status changes that never
arrive, or repeated reconnecting despite Herdr remaining healthy.

### Mutating actions

Control currently uses these socket methods:

- `pane.focus`, `pane.close`, `pane.rename`, `pane.report_metadata`, and `pane.send_keys`
- `workspace.create`
- `tab.create` and `tab.rename`
- `worktree.create` and `worktree.open`
- `agent.start`, `agent.get`, and `agent.prompt`

Control uses `agent.prompt` for both a new Thread's initial message and later
messages from the mobile composer. The HTTP request succeeds only after Herdr
acknowledges the prompt command. It does not require terminal ownership.

Workspace, tab, and Worktree creation must return enough information to resolve
`workspace_id`, `tab_id`, and `root_pane.pane_id`. A new agent is not considered
ready merely because `agent.start` returns: Control polls `agent.get` until the
expected pane, kind, and optional name appear, with `interactive_ready: true`
and no pending launch. During startup, `agent` may be absent or null while
detection catches up. That is a not-ready result, not malformed JSON. Herdr
omits false readiness flags, so an absent `interactive_ready` must never be
treated as ready. Unexpected field types still fail validation.

`tests/browser/new-thread-launch.spec.ts` exercises this transition through the
real HTTP handler, lifecycle, adapter, and parser with only the Herdr transport
substituted. It verifies an unprompted launch, followed by the first message
sent from the conversation after readiness.
Use a disposable session for any subsequent live launch validation.

The following Herdr error codes currently drive behavior and must remain
structured rather than inferred from prose:

- `agent_not_found`: continue polling after `agent.start`.
- `workspace_not_found`: create a replacement workspace when a persisted runtime
  association has gone stale.
- `confirmation_required`: retain a pane because closing it would destroy a
  protected Worktree runtime.
- `pane_not_found`: treat retirement as already complete.

## Herdr terminal command contract

Live terminal transport is provided by the spawned command:

```text
herdr terminal session <control|observe> <pane> --cols <n> --rows <n> [--takeover]
```

Its stdout is NDJSON. Control expects:

- `terminal.frame` with `seq`, `width`, `height`, `full`, and base64 `bytes`.
- `terminal.closed` with an optional `reason`.

Its stdin receives `terminal.input`, `terminal.resize`, `terminal.scroll`, and
`terminal.release` records. Logical keys use the socket's `pane.send_keys`
method so Herdr can encode keys such as Shift+Enter for the active terminal
protocol.

Two occupied-client conditions are currently recognized from Herdr's close
reason text: `already has an attached client` and `terminal attach taken over`.
This text matching is the most fragile part of the ownership adapter. Prefer a
structured Herdr close code if one becomes available.

`HERDR_CONTROL_SOCKET` configures direct socket traffic. Spawned Herdr CLI
commands inherit the process environment and currently do not receive an
explicit socket argument. If a non-default socket is configured, ensure the CLI
also resolves it through the inherited `HERDR_SOCKET_PATH`. Otherwise, socket
state and terminal control can point at different Herdr instances.

The HTTP snapshot fallback and Thread restoration also use Herdr CLI commands:

- `herdr api snapshot`
- `herdr tab create` and `herdr workspace create`
- `herdr agent start ... -- <provider resume arguments>`
- `herdr tab close` or `herdr workspace close` after a failed restore

Any CLI option or JSON response change must be reflected in `HerdrAdapter` even
if the direct socket remains compatible.

## Agent harness contract

Optional [thread naming](thread-naming.md) runs a separate locally authenticated
CLI through `src/server/local-naming.ts`. Preserve its ChatGPT-only default auth,
ephemeral execution, JSON output, timeout, and API-key environment filtering when
upgrading Codex. The default command was checked with Codex 0.153.4 and
`gpt-5.6-luna` on 2026-09-06. Tests in `local-naming.test.ts` and
`thread-naming.test.ts` cover the command and lifecycle boundaries.

Herdr provider integrations supply `agent`, optional stable `name`,
`agent_status`, and optional `agent_session` fields in snapshots. Control uses
those facts to adopt panes, identify Runs, decide between Delete and Archive,
and match a restored process back to its Thread.

An agent session is identified by the complete
`source`/`agent`/`kind`/`value` tuple. Changing any field can prevent an inactive
Thread from being matched and may cause a newly observed Run to be adopted as a
different Thread. Pi `path` references are also host-local: moving Control state
to another machine does not move the referenced provider session file.

Install the Herdr integrations for providers that should become resumable:

```bash
herdr integration install codex
herdr integration install claude
herdr integration install pi
```

Current provider-specific assumptions are:

| Agent | Resume arguments | Skip-permission arguments | Session kinds restored |
| --- | --- | --- | --- |
| Codex | `resume <value>` | `--dangerously-bypass-approvals-and-sandbox` | `id` |
| Claude | `--resume <value>` | `--dangerously-skip-permissions` | `id` |
| Pi | `--session <value>` | `--approve` | `id`, `path` |
| Gemini | Not supported | `--approval-mode=yolo` | None |
| OpenCode | Not supported | `--auto` | None |

Creation passes permission arguments through Herdr's `agent.start`. Restoration
starts the agent in a fresh dedicated tab and passes the resume arguments after
`--`. If a harness changes a flag or session identifier format, update the
single translation functions and their table-driven tests before enabling the
new version.

The UI recognizes `working`, `blocked`, `done`, and `idle` as meaningful status
values. Unknown values remain visible but lose status-specific behavior. In
particular, working duration and the activity shader depend on `working`.
Completion does not imply that the user has read a reply; Control does not yet
track unread messages. Status changes do not change index ordering.

Agent TUIs are rendered rather than semantically parsed, but two presentation
details still require maintenance:

- The light-theme colour adapter recognizes fragmented ANSI SGR sequences and
  remaps dark true-colour or 256-colour backgrounds. Codex and Pi have emitted
  dark RGB surfaces that bypass xterm's theme palette. A changed sequence should
  only require a fixture in `terminal-color-adapter.test.ts`, not harness logic
  in the React view.
- The message composer sends through `agent.prompt`. Direct terminal input is
  reserved for intentional interaction with the agent TUI.

The latest explicitly validated harness versions are recorded in
`docs/prototype-validation.md` and should be updated after live compatibility
checks.

## Browser and xterm contract

Production terminal code uses xterm's public `Terminal`, `FitAddon`,
`WebLinksAddon`, theme, contrast, data, resize, paste, selection, and custom-key
interfaces. Plain-text and OSC 8 links accept only HTTP or HTTPS destinations
and open with `noopener,noreferrer`. Tests also
locate xterm's hidden input element by `.xterm-helper-textarea`; an upstream DOM
rename may break tests even when production input still works.

The browser must provide:

- WebSocket for the terminal channel and EventSource for the live inventory.
- `ResizeObserver` for terminal fitting and shader redraws.
- Page Visibility plus `pagehide`/`pageshow` for safe release and automatic
  reclaim of terminal ownership.
- Pointer Events and pointer capture for stable touch scrolling.
- Visual Viewport for mobile browser chrome and software-keyboard sizing. The
  implementation falls back to `innerWidth`/`innerHeight` when unavailable.
- Canvas 2D, `IntersectionObserver`, and `prefers-reduced-motion` for the working
  treatment. Their absence should affect decoration, not state.
- Async Clipboard for the explicit paste shortcut. Ordinary paste events remain
  a fallback, but Clipboard access generally requires HTTPS or localhost and a
  user gesture.
- `localStorage` for bridge address, settings, creation defaults, conversation
  drafts, cached replies, and reading positions. These are
  intentionally per-browser and are not part of the server database.
- History routing (`pushState`, `popstate`, and server-side SPA fallback) so a
  terminal URL can be refreshed without losing its selected Thread or pane.

Clipboard images are written to a private temporary directory and the absolute
server path is pasted into the terminal. The bridge and the Herdr-owned process
must therefore run on the same machine with access to the same filesystem path.
Files are limited to 16 MiB, validated by signature, mode `0600`, and cleaned up
after 24 hours.

## Node.js, SQLite, and local state

Durable state uses Node's built-in `node:sqlite` `DatabaseSync`; this is why the
minimum supported Node version is 22.5. The database enables foreign keys and
WAL, performs forward-only column/table migrations, and runs SQLite integrity
and foreign-key checks at startup.

Before upgrading Node or changing the schema:

1. Back up the state database with SQLite's online backup command, or stop only
   the Control bridge before copying the database and its WAL files. Herdr and
   its agents do not need to stop.
2. Open a copy with the new runtime and run the unit suite.
3. Confirm existing Projects, Worktrees, archived Threads, active Runs, and
   pending retirements survive reconciliation with a current Herdr snapshot.

The state path and directory are private to the service user (`0600` database,
`0700` newly created directory). Moving the bridge to another account changes
both database access and clipboard-path visibility.

The same database stores the Home bridge's Control Host list. Before replacing
legacy `hosts.json` configuration, run `npm run validate:host-migration` against
an online backup and follow the [host configuration migration](host-configuration-migration.md).

## Reverse proxy and deployment contract

Remote deployments must preserve both long-lived transports:

- `/api/session/events` is SSE with a 15-second heartbeat, `no-transform`, and
  `X-Accel-Buffering: no`.
- `/api/terminal` requires a WebSocket upgrade and supports continuously arriving
  binary-as-JSON terminal frames.

The browser Origin must be in `HERDR_CONTROL_ALLOWED_ORIGINS`. HTTPS is strongly
preferred and is required by browsers for the full Clipboard interface outside
localhost. Tailscale Serve is the tested access layer, but it is not coupled to
the implementation. Any replacement proxy must be checked for SSE buffering,
WebSocket idle timeouts, maximum frame size, and forwarded Origin behavior.

Herdr Control has no application authentication. Keep the bridge on localhost
and expose it only through a trusted authenticated network layer.

The production server resolves `dist/client` from its process working directory,
and spawned Herdr commands resolve `HERDR_CONTROL_BIN` through the service's
environment and `PATH`. A service-manager change must preserve both assumptions
or configure an absolute binary path and the repository working directory.

## Upgrade checklist

Run `npm run test:browser:mock` first. It needs no live agents. After updating
every bridge, use `HERDR_CONTROL_READONLY_URL=https://your-home-bridge npm run
test:browser:readonly` to read active and archived conversations with all writes
and terminal connections blocked. Keep the service in a separate managed
checkout so development builds cannot replace its client assets. The live
interaction checks below require disposable sessions and permission to control them.

1. Record the proposed Herdr, agent harness, Node.js, browser, and xterm versions.
2. Back up Control's SQLite state before a Node, schema, or reconciliation
   change.
3. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
4. Against an isolated Herdr pane, run `npm run test:browser` with the environment
   described in the README.
5. Exercise one shell plus each supported agent: render, resize, scroll, paste,
   Shift+Enter, submit, release, automatic reclaim, observe, and takeover.
6. Create Threads in the project checkout, an existing Worktree, a new Worktree,
   and an attached Worktree. Confirm every new agent receives its own tab.
7. Confirm session references appear after the first provider interaction, then
   archive and restore Codex, Claude, and Pi Threads where supported.
8. Close a pane directly in Herdr and confirm its Run ends and its Thread archives
   in Control, even without a resume reference. Archive a running Thread and verify
   its process continues. Stop it explicitly and check that a protected Worktree
   reports retention instead of claiming the process stopped.
9. Disconnect and restart the bridge, then Herdr, confirming stale state is
   clearly shown and the next complete snapshot converges without duplicates.
10. Smoke-test the deployed HTTPS URL for SSE, WebSocket, clipboard, background
    release, and focus reclaim. Update this document and prototype validation
    with the versions and any changed assumptions.

Reply capture is another provider seam: see [capture setup and contracts](reply-capture.md).
Run `npm run test:browser:mock` for conversations, drafts, receipt recovery, and
terminal drill-down before live validation. The hook fixtures validate import and
deduplication; they do not substitute for exercising each installed agent version.
