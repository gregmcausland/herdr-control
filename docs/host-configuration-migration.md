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

## Completion and recovery

Before removing a legacy file, confirm that every expected host is returned by
`/api/control-hosts`, each host loads its Projects, the migration marker exists,
and SQLite integrity and foreign-key checks pass.

To recover, stop the user service, restore the pre-migration `control.db` backup
and saved service unit if required, then restart the service. These backups
contain Control metadata and host URLs, not access-layer authentication
credentials.
