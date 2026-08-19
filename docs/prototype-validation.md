# Prototype validation

Validated on 19 August 2026 against Herdr 0.8.0, protocol 19.

## Proven path

- The independent Vite client connected to a supplied bridge URL over the host's Tailscale address.
- The production bridge served the same built client and handled same-origin HTTP and WebSocket traffic.
- The picker grouped panes by Herdr workspace from authoritative
  `session.snapshot` reads triggered by lifecycle and pane-status socket events.
- xterm.js rendered full and incremental ANSI frames from `herdr terminal session`.
- Browser input reached an isolated Herdr shell; disconnecting and reconnecting left the shell alive.
- Resize changed the controller viewport and produced a frame at the requested dimensions.
- Two browsers exercised control contention, observation, explicit takeover, release, and reconnect.
- The phone-width picker and terminal fit without document-level horizontal overflow.

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
