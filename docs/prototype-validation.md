# Prototype validation

This record separates isolated automated tests from live inspection. The older
terminal checks below remain historical evidence, not a claim that every provider
interaction was repeated for the latest UI.

## Conversation and organisation update, 5 September 2026

Validated through implementation commit `fbbd461`:

- Type checking, production builds, and 180 unit tests passed.
- All 25 isolated browser checks passed in Chromium. They cover saved drafts,
  lost send acknowledgements, unavailable hosts, terminal recovery, multi-host
  isolation, and New thread validation and submission.
- The launch regression uses the real Control server, lifecycle, Herdr adapter,
  and response parser with a substituted Herdr transport. It reproduces an absent
  agent kind during startup and verifies one prompt only after explicit readiness.
  This is not evidence of a new live agent being launched.
- Project and Thread ordering remained stable through status changes, reordered
  incoming panes, and reload. Empty Projects remained available in the picker;
  archived Threads appeared only in Archive.
- Conversation checks verified changing canvas frames while working and a
  stationary canvas under reduced motion. The working strip disappeared on
  completion and disconnection without losing a draft.
- Phone, desktop, light-theme, 320px-wide, and 390 x 430 keyboard-sized layouts
  were inspected. Long-history checks covered reading position, visible working
  feedback, and Jump to latest.
- Both managed deployments built and restarted successfully, preserving their
  databases. Playwright opened live index pages, project pickers, archives, and
  active and archived conversations, including reload. Mutation requests and all
  terminal WebSockets were blocked during these checks; no live agents were
  started, stopped, or messaged.
- Live Codex prompts and completed replies were observed through installed capture
  hooks. Provider-wide hook activation and physical iPhone/Safari testing remain
  outstanding; fixture coverage does not establish those results.

Reproduce the isolated suite with `npm run test:browser:mock`. The committed
deployment check is `npm run test:browser:readonly` with
`HERDR_CONTROL_READONLY_URL` set to the Home bridge. It checks active and archived
conversations across configured hosts. Index, picker, archive-navigation, and
animation inspection on deployed pages was additional read-only Playwright work.

## Terminal baseline, 19 August 2026

Validated against Herdr 0.8.0, protocol 19.

### Proven path

- The independent Vite client connected to a supplied bridge URL over the host's Tailscale address.
- The production bridge served the same built client and handled same-origin HTTP and WebSocket traffic.
- The picker grouped panes by durable Project while Herdr workspace, Worktree,
  pane, and agent state came from authoritative snapshot reads triggered by
  lifecycle and pane-status socket events.
- xterm.js rendered full and incremental ANSI frames from `herdr terminal session`.
- Browser input reached an isolated Herdr shell; disconnecting and reconnecting left the shell alive.
- Resize changed the controller viewport and produced a frame at the requested dimensions.
- Two browsers exercised control contention, observation, explicit takeover, release, and reconnect.
- The phone-width picker and terminal fit without document-level horizontal overflow.
- Light terminal themes remapped dark true-colour Codex and Pi surfaces in the
  browser while dark themes preserved the original ANSI bytes.

### Interaction matrix

| Surface | Evidence |
| --- | --- |
| Shell | Text/Enter, cursor-left editing, Tab completion, multiline bracketed paste, Ctrl+C, resize, reconnect |
| Codex 0.148.0 | Full-screen rendering, slash menu/Escape, browser paste, prompt submission, response redraw, survives browser disconnect |
| Pi 0.84.2 | Full-screen rendering, slash menu/Escape, browser paste, native `!` command execution and output |
| Claude Code 2.1.235 | Full-screen rendering, slash menu/Escape, keyboard input, prompt submission, working-state redraw, response output |

Pi's model request could not be tested because the installed Pi authentication token was expired. Its native TUI and local command path were validated without requiring credentials.

Claude Code did not accept the synthetic clipboard event used by the automated check, although normal keyboard input worked. Shell, Codex, and Pi accepted the same xterm.js paste path. Real mobile clipboard behaviour remains a focused follow-up rather than a terminal-rendering blocker.

Chromium desktop and a 390×844 mobile viewport passed. WebKit was not run because this host lacks Playwright's GTK/WebKit runtime libraries; Safari compatibility is therefore unverified.

## State reconciliation

Validated on 20 August 2026 against the existing production state database and
live Herdr daemon:

- The database migrated in place without changing existing Thread or Run IDs.
- Project and Worktree IDs remained stable across Control restarts.
- Two live Herdr agent terminals reconciled to exactly two open Threads and two
  active Runs.
- One historical open Thread with no live Run was detected and auto-archived.
- Repository integrity and foreign-key checks passed before and after migration.
- A snapshot invalidated by a racing Herdr event is discarded before durable
  reconciliation, then replaced by the next quiet snapshot.
- The Project creation action was exercised against an isolated named Herdr
  session: Control created a second tab with one root pane, started Pi in that
  pane, and adopted the observed agent as a Project/Worktree-owned Thread and
  Run. The isolated session was deleted after verification.
- The creation dialog was inspected at 1280×900 and 390×844; its default and
  conditional Worktree fields remain usable without viewport overflow.

Logical keys are currently dispatched through Herdr's pane action after Control
checks terminal ownership. Herdr's terminal-session stream does not yet carry a
logical-key message, so ownership cannot be checked atomically with that action;
this is the remaining upstream boundary for key-input contention.
