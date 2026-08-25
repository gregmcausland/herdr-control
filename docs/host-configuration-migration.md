# Host configuration migration

Older builds bundled their Control Host list from `src/client/hosts.json`. That
file contained display names and URLs only. It never contained Tailscale or
other authentication credentials.

Runtime host management stores this list in the Home bridge's existing local
SQLite database. The importer remains available for an old file supplied
through `HERDR_CONTROL_LEGACY_HOSTS`; current builds do not bundle one.

## Migration design

1. Add the database table and importer while the client still reads
   `hosts.json`.
2. Import entries in one database transaction. Match existing records by
   normalized URL, add missing entries, and never overwrite a newer database
   label.
3. Record a migration marker only after the transaction commits.
4. Read the Control Host list from the database, retaining `hosts.json` as a
   fallback for that release.
5. Confirm the imported machines appear and connect before removing the file in
   a later release.

The importer is safe to run more than once. A failed import leaves the existing
file and database records usable. Before importing, back up the Control state
database and the legacy JSON file.

Validate the importer against an online backup without changing the running
database:

```bash
npm run validate:host-migration -- /path/to/control.db /path/to/hosts.json
```

The validator works on an online copy and does not change the supplied database.

## Greg's completed migration

Completed on 25 August 2026:

- Server MZ retained 3 Projects, 6 Worktrees, 19 Threads, and 24 Runs. Its
  database backup is
  `~/.local/state/herdr-control/control.db.backup-20260825T191321Z`.
- Alien MZ retained 3 Projects, 3 Worktrees, 7 Threads, and 9 Runs. Its installer
  backup is `~/.local/state/herdr-control/control.db.backup-20260825T192810Z`;
  an additional pre-cutover backup and service unit are under
  `~/.local/state/herdr-control/migration-backups/20260825T192806Z/`.
- Both databases passed integrity checks, contain the one-time migration marker,
  and return `Server MZ` and `Alien MZ` from `/api/control-hosts`.
- Both hosts loaded Projects over their Tailscale URLs. Alien MZ's original
  checkout remains at `~/Projects/herdr-control`; the managed checkout is
  `~/Projects/herdr-control-managed`.

To recover, stop the user service, restore the relevant `control.db` backup,
restore the saved unit if required, then restart the service. The backups contain
Control metadata and host URLs, not Tailscale authentication credentials.
