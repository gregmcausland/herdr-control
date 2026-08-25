# Herdr Control roadmap

This is the short list of work needed to turn the current prototype into a
straightforward public project. It records direction, not release dates.

## Shipped foundation

- [x] Browser terminal control for Herdr panes on desktop and mobile.
- [x] Durable Projects, Worktrees, Threads, Runs, archiving, and restoration.
- [x] Consolidated Project view across multiple configured Herdr machines.
- [x] Independent per-machine live state, reconnection, and stale-state handling.
- [x] Central Herdr protocol validation before runtime reconciliation.
- [x] Private remote access through Tailscale Serve, with Control remaining on
  the user's machines.

## Product work

- [ ] **Release groundwork.** Add a licence, security notes, and CI checks. Keep
  the existing host file intact until its entries have migrated.
- [x] **Managed installation.** Provide one installation path for the bridge and
  bundled client, with user-level startup, status, logs, updates, and removal.
- [x] **Runtime Control Host management.** Store the Home bridge's Control Host
  list in its local database and provide add, rename, remove, and health-check
  actions in Control. Follow the [host configuration migration](docs/host-configuration-migration.md)
  before removing `hosts.json`.
- [x] **Multi-host hardening.** Report protocol incompatibility per machine,
  improve offline recovery, and run repeatable two-host browser coverage.

## Public release

- [ ] Complete the host configuration migration, verify every existing Control
  Host, then remove personal configuration and provide safe defaults.
- [ ] Publish versioned release artifacts with compatibility information.
- [ ] Provide a five-minute install, Control Host setup, and first-Thread
  walkthrough.

## Architecture follow-ups

- [x] Move Thread creation and deletion policy out of HTTP routes and deepen the
  existing Thread lifecycle module.
- [x] Concentrate route, request, pending, stale-state, and modal transitions in
  a client orchestration-state module, leaving React focused on rendering.

## Possible later work

- Let Herdr install and manage the companion bridge directly.
- Add Control-owned authentication only if users need access without Tailscale
  Serve or another trusted private access layer.
- Explore one trusted Control bridge connecting to remote Herdr machines over
  SSH, if per-machine installation proves to be a real adoption problem.
