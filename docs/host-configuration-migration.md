# Host configuration migration

The current client bundles its Control Host list from `src/client/hosts.json`.
That file contains display names and URLs. It does not contain Tailscale or
other authentication credentials.

Runtime host management will move this list into the Home bridge's existing
local SQLite database. The migration must preserve every existing entry for
people upgrading an installation they already use.

## Required rollout

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

The importer must be safe to run more than once. A failed import must leave the
existing file and database records usable. Before the migration release is
installed, the upgrade instructions must include a backup of the Control state
database and `hosts.json`.

Validate the importer against an online backup without changing the running
database:

```bash
npm run validate:host-migration
```

Pass explicit database and host-file paths as the first and second arguments if
the installation does not use the defaults.

For Greg's current installation, the migration is complete only when both
`Server MZ` and `Alien MZ` appear from database-backed configuration and their
Projects load successfully.
