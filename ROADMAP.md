# Herdr Control roadmap

This is the short list of work needed to turn the current prototype into a
straightforward public project. It records direction, not release dates.

## Shipped foundation

- [x] Browser terminal control for Herdr panes on desktop and mobile.
- [x] Durable Projects, Worktrees, Threads, Runs, archiving, and restoration.
- [x] Consolidated Project view across multiple configured Herdr machines.
- [x] Independent per-machine live state, reconnection, and stale-state handling.
- [x] Central Herdr protocol validation before runtime reconciliation.

## Product work

- [ ] **Managed installation.** Provide one installation path for the bridge and
  bundled client, with user-level startup, status, logs, updates, and removal.
- [ ] **Secure bridge access.** Add simple pairing credentials and authenticate
  HTTP, SSE, and WebSocket traffic without introducing a full account system.
- [ ] **Runtime host management.** Replace build-time `hosts.json` configuration
  with add, rename, remove, pair, and health-check actions in Control.
- [ ] **Multi-host hardening.** Report protocol incompatibility per machine,
  improve offline recovery, and run repeatable two-host browser coverage.

## Public release

- [ ] Remove personal host configuration and provide safe example defaults.
- [ ] Add the open-source licence, contribution notes, and security guidance.
- [ ] Publish versioned release artifacts with compatibility information.
- [ ] Provide a five-minute install, pairing, and first-Thread walkthrough.

## Architecture follow-ups

- [ ] Move Thread creation and deletion policy out of HTTP routes and deepen the
  existing Thread lifecycle module.
- [ ] Concentrate route, request, pending, stale-state, and modal transitions in
  a client orchestration-state module, leaving React focused on rendering.

## Possible later work

- Let Herdr install and manage the companion bridge directly.
- Explore one trusted Control bridge connecting to remote Herdr machines over
  SSH, if per-machine installation proves to be a real adoption problem.
