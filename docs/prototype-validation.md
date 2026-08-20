# Prototype validation

Validated on 19 August 2026 against Herdr 0.8.0, protocol 19.

## Proven path

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

## Interaction matrix

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
