import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeControlHostUrl,
  type ControlHost,
  type StoredControlHost,
} from "../shared/control-hosts.js";

const LEGACY_MIGRATION = "control-hosts-from-json-v1";

interface ControlHostStoreOptions {
  path: string;
  legacyHosts?: readonly ControlHost[];
  now?: () => string;
  createId?: () => string;
}

interface ControlHostRow {
  host_id: string;
  label: string;
  url: string;
  created_at: string;
  updated_at: string;
}

export class ControlHostNotFoundError extends Error {}
export class ControlHostConflictError extends Error {}

/** Owns the Home bridge's durable list of Control Hosts. */
export class ControlHostStore {
  private readonly database: DatabaseSync;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: ControlHostStoreOptions) {
    this.database = new DatabaseSync(options.path);
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    try {
      this.database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS control_hosts (
          host_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          url TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS control_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      if (options.legacyHosts) this.importLegacyHosts(options.legacyHosts);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  list(): StoredControlHost[] {
    return (this.database.prepare(`
      SELECT * FROM control_hosts ORDER BY label COLLATE NOCASE, url
    `).all() as unknown as ControlHostRow[]).map(hostFromRow);
  }

  add(host: ControlHost): StoredControlHost {
    const label = normalizeLabel(host.label);
    const url = normalizeControlHostUrl(host.url);
    const timestamp = this.now();
    const hostId = this.createId();
    try {
      this.database.prepare(`
        INSERT INTO control_hosts (host_id, label, url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(hostId, label, url, timestamp, timestamp);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ControlHostConflictError(`Control Host ${url} already exists`);
      }
      throw error;
    }
    return this.get(hostId)!;
  }

  update(hostId: string, host: ControlHost): StoredControlHost {
    const label = normalizeLabel(host.label);
    const url = normalizeControlHostUrl(host.url);
    try {
      const result = this.database.prepare(`
        UPDATE control_hosts SET label = ?, url = ?, updated_at = ? WHERE host_id = ?
      `).run(label, url, this.now(), hostId);
      if (result.changes === 0) {
        throw new ControlHostNotFoundError(`Control Host ${hostId} was not found`);
      }
    } catch (error) {
      if (error instanceof ControlHostNotFoundError) throw error;
      if (isUniqueConstraint(error)) {
        throw new ControlHostConflictError(`Control Host ${url} already exists`);
      }
      throw error;
    }
    return this.get(hostId)!;
  }

  delete(hostId: string): void {
    const result = this.database.prepare("DELETE FROM control_hosts WHERE host_id = ?").run(hostId);
    if (result.changes === 0) {
      throw new ControlHostNotFoundError(`Control Host ${hostId} was not found`);
    }
  }

  close(): void {
    this.database.close();
  }

  private get(hostId: string): StoredControlHost | undefined {
    const row = this.database.prepare("SELECT * FROM control_hosts WHERE host_id = ?")
      .get(hostId) as unknown as ControlHostRow | undefined;
    return row ? hostFromRow(row) : undefined;
  }

  private importLegacyHosts(hosts: readonly ControlHost[]): void {
    const applied = this.database.prepare("SELECT 1 FROM control_migrations WHERE name = ?")
      .get(LEGACY_MIGRATION);
    if (applied) return;

    const normalized = hosts.map((host) => ({
      label: normalizeLabel(host.label),
      url: normalizeControlHostUrl(host.url),
    }));
    const timestamp = this.now();
    this.transaction(() => {
      const insert = this.database.prepare(`
        INSERT INTO control_hosts (host_id, label, url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO NOTHING
      `);
      for (const host of normalized) {
        insert.run(this.createId(), host.label, host.url, timestamp, timestamp);
      }
      this.database.prepare(`
        INSERT INTO control_migrations (name, applied_at) VALUES (?, ?)
      `).run(LEGACY_MIGRATION, timestamp);
    });
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function readLegacyControlHosts(path: string | undefined): ControlHost[] | undefined {
  if (!path || !existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value)) throw new Error("Legacy Control Host configuration must be an array");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Legacy Control Host entry is invalid");
    const { label, url } = item as { label?: unknown; url?: unknown };
    if (typeof label !== "string" || typeof url !== "string") {
      throw new Error("Legacy Control Host entry requires a label and URL");
    }
    return { label, url };
  });
}

function hostFromRow(row: ControlHostRow): StoredControlHost {
  return {
    host_id: row.host_id,
    label: row.label,
    url: row.url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeLabel(value: string): string {
  const label = value.trim();
  if (!label || label.length > 120) {
    throw new Error("Control Host label must contain between 1 and 120 characters");
  }
  return label;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: control_hosts\.url/.test(error.message);
}
