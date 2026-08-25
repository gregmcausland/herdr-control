import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { ControlHostStore } from "../dist/server/server/control-hosts.js";

const sourcePath = resolve(process.argv[2] ?? join(homedir(), ".local/state/herdr-control/control.db"));
const legacyPath = resolve(process.argv[3] ?? "src/client/hosts.json");
const temporary = mkdtempSync(join(tmpdir(), "herdr-control-migration-check-"));

try {
  const copyPath = join(temporary, "control.db");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const before = tableCounts(source);
  await backup(source, copyPath);
  source.close();

  const legacyHosts = JSON.parse(readFileSync(legacyPath, "utf8"));
  const hosts = new ControlHostStore({ path: copyPath, legacyHosts });
  const imported = hosts.list().map(({ label, url }) => ({ label, url }));
  hosts.close();

  const migrated = new DatabaseSync(copyPath, { readOnly: true });
  const after = tableCounts(migrated);
  const integrity = migrated.prepare("PRAGMA integrity_check").get().integrity_check;
  migrated.close();

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Host migration changed existing Control record counts");
  }
  if (integrity !== "ok") throw new Error(`Migrated database integrity check failed: ${integrity}`);

  console.log(JSON.stringify({ sourcePath, before, after, integrity, imported }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function tableCounts(database) {
  return Object.fromEntries(
    ["projects", "worktrees", "threads", "runs"].map((table) => [
      table,
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  );
}
