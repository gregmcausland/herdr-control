import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentSessionReference,
  PaneInfo,
  SessionSnapshot,
  ThreadInfo,
  ThreadLifecycle,
} from "../shared/protocol.js";

interface ThreadManagerOptions {
  path: string;
  retirePane?: (paneId: string) => Promise<PaneRetirementOutcome>;
  restoreThread?: (request: ThreadRestoreRequest) => Promise<void>;
  now?: () => string;
  createId?: () => string;
}

export type PaneRetirementOutcome = "retired" | "retained";

export interface ThreadRestoreRequest {
  threadId: string;
  agentName: string;
  title: string;
  agent: string;
  session: AgentSessionReference;
  workspaceId: string;
  workspaceLabel: string;
  cwd?: string;
}

interface ThreadRow {
  thread_id: string;
  title: string;
  agent_kind: string;
  agent_name: string | null;
  session_source: string | null;
  session_agent: string | null;
  session_kind: string | null;
  session_value: string | null;
  restore_agent_name: string | null;
  lifecycle: ThreadLifecycle;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface RunRow {
  run_id: string;
  thread_id: string;
  workspace_id: string;
  workspace_label: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  cwd: string | null;
  agent_status: string | null;
  started_at: string;
  ended_at: string | null;
}

interface ThreadWithRunRow extends ThreadRow {
  run_id: string | null;
  workspace_id: string | null;
  workspace_label: string | null;
  tab_id: string | null;
  pane_id: string | null;
  terminal_id: string | null;
  cwd: string | null;
  agent_status: string | null;
  started_at: string | null;
}

export class ThreadNotFoundError extends Error {}
export class ThreadNotRestorableError extends Error {}

/** Owns durable Thread identity while projecting transient Herdr Runs onto it. */
export class ThreadManager {
  private readonly database: DatabaseSync;
  private readonly retirePane: (paneId: string) => Promise<PaneRetirementOutcome>;
  private readonly restoreThread: (request: ThreadRestoreRequest) => Promise<void>;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly retirements = new Map<string, Promise<PaneRetirementOutcome>>();
  private topologyKey?: string;

  constructor(options: ThreadManagerOptions) {
    if (options.path !== ":memory:") {
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(options.path), 0o700);
    }
    this.database = new DatabaseSync(options.path);
    if (options.path !== ":memory:") chmodSync(options.path, 0o600);
    this.retirePane = options.retirePane ?? (async () => "retired");
    this.restoreThread = options.restoreThread ?? (async () => {
      throw new ThreadNotRestorableError("Thread restore is not configured");
    });
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    this.migrate();
  }

  reconcile(snapshot: SessionSnapshot): SessionSnapshot {
    const observedAt = this.now();
    const agentByPane = new Map((snapshot.agents ?? []).map((agent) => [agent.pane_id, agent]));
    const workspaceLabels = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]));
    const assignments = new Map<string, { threadId: string; runId: string }>();
    const observedPaneIds = new Set<string>();

    this.transaction(() => {
      for (const pane of snapshot.panes) {
        const observed = { ...pane, ...agentByPane.get(pane.pane_id) };
        if (!observed.agent) continue;
        observedPaneIds.add(observed.pane_id);

        const session = observed.agent_session;
        let run = this.activeRunForPane(observed.pane_id);
        let threadId = run?.thread_id;
        let claimedRestore = false;

        if (!threadId) {
          threadId = observed.name ? this.restoringThreadFor(observed.name) : undefined;
          claimedRestore = Boolean(threadId);
          threadId ??= session ? this.resumableThreadFor(session) : undefined;
          if (!threadId) threadId = this.createThread(observed, observedAt);
          run = this.createRun(
            threadId,
            observed,
            workspaceLabels.get(observed.workspace_id) ?? observed.workspace_id,
            observedAt,
          );
          this.recordEvent(threadId, run.run_id, "run.started", observedAt);
          if (claimedRestore) {
            this.database.prepare(`
              UPDATE threads
              SET lifecycle = 'open', archived_at = NULL, restore_agent_name = NULL, updated_at = ?
              WHERE thread_id = ?
            `).run(observedAt, threadId);
            this.recordEvent(threadId, run.run_id, "thread.restored", observedAt);
          }
        }

        if (!run) throw new Error(`Unable to bind Run for ${observed.pane_id}`);

        this.updateThread(threadId, observed, observedAt);
        this.updateRun(
          run.run_id,
          observed,
          workspaceLabels.get(observed.workspace_id) ?? observed.workspace_id,
          observedAt,
        );
        assignments.set(observed.pane_id, { threadId, runId: run.run_id });
      }

      for (const run of this.activeRuns()) {
        if (observedPaneIds.has(run.pane_id)) continue;
        this.database.prepare("UPDATE runs SET ended_at = ?, updated_at = ? WHERE run_id = ?")
          .run(observedAt, observedAt, run.run_id);
        this.database.prepare("UPDATE threads SET updated_at = ? WHERE thread_id = ?")
          .run(observedAt, run.thread_id);
        this.recordEvent(run.thread_id, run.run_id, "run.ended", observedAt);
      }

      const livePaneIds = new Set(snapshot.panes.map((pane) => pane.pane_id));
      for (const paneId of this.retiredPaneIds()) {
        if (!livePaneIds.has(paneId)) {
          this.database.prepare("DELETE FROM pane_retirements WHERE pane_id = ?").run(paneId);
        }
      }
    });

    const threads = this.list();
    const retiredPaneIds = this.retiredPaneIds();
    const hiddenPaneIds = new Set([
      ...retiredPaneIds,
      ...threads.flatMap((thread) =>
        thread.lifecycle === "archived" && thread.current_run ? [thread.current_run.pane_id] : []
      ),
    ]);
    const nextTopologyKey = snapshot.panes
      .map((pane) => `${pane.workspace_id}/${pane.tab_id}/${pane.pane_id}`)
      .sort()
      .join("|");
    if (nextTopologyKey !== this.topologyKey) {
      this.topologyKey = nextTopologyKey;
      for (const paneId of hiddenPaneIds) {
        if (observedPaneIds.has(paneId) || snapshot.panes.some((pane) => pane.pane_id === paneId)) {
          void this.requestPaneRetirement(paneId).catch(() => undefined);
        }
      }
    }

    return {
      ...snapshot,
      panes: snapshot.panes
        .filter((pane) => !hiddenPaneIds.has(pane.pane_id))
        .map((pane) => {
          const assignment = assignments.get(pane.pane_id);
          return assignment
            ? { ...pane, thread_id: assignment.threadId, run_id: assignment.runId }
            : pane;
        }),
      agents: snapshot.agents?.filter((agent) => !hiddenPaneIds.has(agent.pane_id)),
      threads,
    };
  }

  list(): ThreadInfo[] {
    const rows = this.database.prepare(`
      SELECT
        threads.*,
        runs.run_id,
        runs.workspace_id,
        runs.workspace_label,
        runs.tab_id,
        runs.pane_id,
        runs.terminal_id,
        runs.cwd,
        runs.agent_status,
        runs.started_at
      FROM threads
      LEFT JOIN runs ON runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
      ORDER BY threads.created_at, threads.thread_id
    `).all() as unknown as ThreadWithRunRow[];
    return rows.map(threadInfoFromRow);
  }

  async archive(threadId: string): Promise<ThreadInfo> {
    const archivedAt = this.now();
    const existing = this.thread(threadId);
    if (!existing) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    const newlyArchived = existing.lifecycle !== "archived";

    if (newlyArchived) {
      this.transaction(() => {
        this.database.prepare(`
          UPDATE threads
          SET lifecycle = 'archived', archived_at = ?, restore_agent_name = NULL, updated_at = ?
          WHERE thread_id = ?
        `).run(archivedAt, archivedAt, threadId);
        this.recordEvent(threadId, null, "thread.archived", archivedAt);
      });
    }

    const current = this.thread(threadId);
    if (!current) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    if (current.current_run) {
      void this.requestPaneRetirement(current.current_run.pane_id).catch(() => undefined);
    }
    return current;
  }

  /** Removes a transient pane from Control while Herdr retirement completes independently. */
  deletePane(paneId: string): void {
    this.database.prepare(`
      INSERT INTO pane_retirements (pane_id, requested_at)
      VALUES (?, ?)
      ON CONFLICT(pane_id) DO NOTHING
    `).run(paneId, this.now());
    void this.requestPaneRetirement(paneId).catch(() => undefined);
  }

  async restore(threadId: string): Promise<ThreadInfo> {
    const existing = this.thread(threadId);
    if (!existing) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    if (existing.lifecycle !== "archived") {
      throw new ThreadNotRestorableError("Only archived Threads can be restored");
    }
    if (!existing.agent_session) {
      throw new ThreadNotRestorableError("This Thread has no agent session reference");
    }
    if (existing.restoring) {
      throw new ThreadNotRestorableError("This Thread is already being restored");
    }
    if (existing.current_run) {
      throw new ThreadNotRestorableError("This Thread is still retiring its active pane");
    }

    const lastRun = this.latestRun(threadId);
    if (!lastRun) throw new ThreadNotRestorableError("This Thread has no previous Run location");

    const restoredAt = this.now();
    const agentName = restoredAgentName(threadId);
    this.transaction(() => {
      this.database.prepare(`
        UPDATE threads
        SET restore_agent_name = ?, updated_at = ?
        WHERE thread_id = ?
      `).run(agentName, restoredAt, threadId);
      this.recordEvent(threadId, null, "thread.restore_requested", restoredAt);
    });

    try {
      await this.restoreThread({
        threadId,
        agentName,
        title: existing.title,
        agent: existing.agent,
        session: existing.agent_session,
        workspaceId: lastRun.workspace_id,
        workspaceLabel: lastRun.workspace_label,
        cwd: lastRun.cwd ?? undefined,
      });
    } catch (error) {
      const failedAt = this.now();
      this.transaction(() => {
        this.database.prepare(`
          UPDATE threads
          SET restore_agent_name = NULL, updated_at = ?
          WHERE thread_id = ?
        `).run(failedAt, threadId);
        this.recordEvent(threadId, null, "thread.restore_failed", failedAt);
      });
      throw error;
    }

    return this.thread(threadId)!;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent_kind TEXT NOT NULL,
        agent_name TEXT,
        session_source TEXT,
        session_agent TEXT,
        session_kind TEXT,
        session_value TEXT,
        restore_agent_name TEXT,
        lifecycle TEXT NOT NULL DEFAULT 'open' CHECK (lifecycle IN ('open', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id),
        workspace_id TEXT NOT NULL,
        workspace_label TEXT NOT NULL,
        tab_id TEXT NOT NULL,
        pane_id TEXT NOT NULL UNIQUE,
        terminal_id TEXT NOT NULL,
        cwd TEXT,
        agent_status TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_per_thread
      ON runs(thread_id) WHERE ended_at IS NULL;

      CREATE TABLE IF NOT EXISTS thread_events (
        event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id),
        run_id TEXT REFERENCES runs(run_id),
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pane_retirements (
        pane_id TEXT PRIMARY KEY,
        requested_at TEXT NOT NULL
      );
    `);

    const columns = this.database.prepare("PRAGMA table_info(threads)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "restore_agent_name")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN restore_agent_name TEXT");
    }
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS threads_one_restore_claim
      ON threads(restore_agent_name) WHERE restore_agent_name IS NOT NULL;
    `);
  }

  private createThread(pane: PaneInfo, createdAt: string): string {
    const threadId = this.createId();
    const session = pane.agent_session;
    this.database.prepare(`
      INSERT INTO threads (
        thread_id, title, agent_kind, agent_name,
        session_source, session_agent, session_kind, session_value,
        lifecycle, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      threadId,
      titleOf(pane),
      pane.agent!,
      pane.name ?? null,
      session?.source ?? null,
      session?.agent ?? null,
      session?.kind ?? null,
      session?.value ?? null,
      createdAt,
      createdAt,
    );
    this.recordEvent(threadId, null, "thread.adopted", createdAt);
    return threadId;
  }

  private createRun(
    threadId: string,
    pane: PaneInfo,
    workspaceLabel: string,
    startedAt: string,
  ): RunRow {
    const runId = this.createId();
    this.database.prepare(`
      INSERT INTO runs (
        run_id, thread_id, workspace_id, workspace_label, tab_id, pane_id,
        terminal_id, cwd, agent_status, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      threadId,
      pane.workspace_id,
      workspaceLabel,
      pane.tab_id,
      pane.pane_id,
      pane.terminal_id,
      pane.foreground_cwd ?? pane.cwd ?? null,
      pane.agent_status ?? null,
      startedAt,
      startedAt,
    );
    return this.activeRunForPane(pane.pane_id)!;
  }

  private updateThread(threadId: string, pane: PaneInfo, updatedAt: string): void {
    const session = pane.agent_session;
    this.database.prepare(`
      UPDATE threads SET
        title = ?,
        agent_kind = ?,
        agent_name = COALESCE(?, agent_name),
        session_source = COALESCE(?, session_source),
        session_agent = COALESCE(?, session_agent),
        session_kind = COALESCE(?, session_kind),
        session_value = COALESCE(?, session_value),
        updated_at = ?
      WHERE thread_id = ?
    `).run(
      titleOf(pane),
      pane.agent!,
      pane.name ?? null,
      session?.source ?? null,
      session?.agent ?? null,
      session?.kind ?? null,
      session?.value ?? null,
      updatedAt,
      threadId,
    );
  }

  private updateRun(runId: string, pane: PaneInfo, workspaceLabel: string, updatedAt: string): void {
    this.database.prepare(`
      UPDATE runs SET
        workspace_id = ?,
        workspace_label = ?,
        tab_id = ?,
        terminal_id = ?,
        cwd = ?,
        agent_status = ?,
        updated_at = ?
      WHERE run_id = ?
    `).run(
      pane.workspace_id,
      workspaceLabel,
      pane.tab_id,
      pane.terminal_id,
      pane.foreground_cwd ?? pane.cwd ?? null,
      pane.agent_status ?? null,
      updatedAt,
      runId,
    );
  }

  private resumableThreadFor(session: AgentSessionReference): string | undefined {
    const row = this.database.prepare(`
      SELECT threads.thread_id
      FROM threads
      WHERE
        lifecycle = 'open'
        AND session_source = ?
        AND session_agent = ?
        AND session_kind = ?
        AND session_value = ?
        AND NOT EXISTS (
          SELECT 1 FROM runs
          WHERE runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
        )
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(session.source, session.agent, session.kind, session.value) as { thread_id?: string } | undefined;
    return row?.thread_id;
  }

  private restoringThreadFor(agentName: string): string | undefined {
    const row = this.database.prepare(`
      SELECT thread_id FROM threads
      WHERE lifecycle = 'archived' AND restore_agent_name = ?
      LIMIT 1
    `).get(agentName) as { thread_id?: string } | undefined;
    return row?.thread_id;
  }

  private activeRunForPane(paneId: string): RunRow | undefined {
    return this.database.prepare("SELECT * FROM runs WHERE pane_id = ? AND ended_at IS NULL")
      .get(paneId) as unknown as RunRow | undefined;
  }

  private activeRuns(): RunRow[] {
    return this.database.prepare("SELECT * FROM runs WHERE ended_at IS NULL")
      .all() as unknown as RunRow[];
  }

  private latestRun(threadId: string): RunRow | undefined {
    return this.database.prepare(`
      SELECT * FROM runs
      WHERE thread_id = ?
      ORDER BY started_at DESC, run_id DESC
      LIMIT 1
    `).get(threadId) as unknown as RunRow | undefined;
  }

  private thread(threadId: string): ThreadInfo | undefined {
    const row = this.database.prepare(`
      SELECT
        threads.*,
        runs.run_id,
        runs.workspace_id,
        runs.workspace_label,
        runs.tab_id,
        runs.pane_id,
        runs.terminal_id,
        runs.cwd,
        runs.agent_status,
        runs.started_at
      FROM threads
      LEFT JOIN runs ON runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
      WHERE threads.thread_id = ?
    `).get(threadId) as unknown as ThreadWithRunRow | undefined;
    return row ? threadInfoFromRow(row) : undefined;
  }

  private recordEvent(threadId: string, runId: string | null, kind: string, createdAt: string): void {
    this.database.prepare(`
      INSERT INTO thread_events (event_id, thread_id, run_id, kind, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(this.createId(), threadId, runId, kind, createdAt);
  }

  private retiredPaneIds(): string[] {
    return (this.database.prepare("SELECT pane_id FROM pane_retirements ORDER BY requested_at, pane_id")
      .all() as unknown as Array<{ pane_id: string }>).map((row) => row.pane_id);
  }

  private requestPaneRetirement(paneId: string): Promise<PaneRetirementOutcome> {
    const existing = this.retirements.get(paneId);
    if (existing) return existing;
    const retirement = this.retirePane(paneId).finally(() => this.retirements.delete(paneId));
    this.retirements.set(paneId, retirement);
    return retirement;
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

function threadInfoFromRow(row: ThreadWithRunRow): ThreadInfo {
  const agentSession = row.session_source && row.session_agent && row.session_kind && row.session_value
    ? {
        source: row.session_source,
        agent: row.session_agent,
        kind: row.session_kind,
        value: row.session_value,
      }
    : undefined;
  const currentRun = row.run_id && row.workspace_id && row.workspace_label && row.tab_id
    && row.pane_id && row.terminal_id && row.started_at
    ? {
        run_id: row.run_id,
        workspace_id: row.workspace_id,
        workspace_label: row.workspace_label,
        tab_id: row.tab_id,
        pane_id: row.pane_id,
        terminal_id: row.terminal_id,
        cwd: row.cwd ?? undefined,
        agent_status: row.agent_status ?? undefined,
        started_at: row.started_at,
      }
    : undefined;
  return {
    thread_id: row.thread_id,
    title: row.title,
    agent: row.agent_kind,
    agent_name: row.agent_name ?? undefined,
    agent_session: agentSession,
    lifecycle: row.lifecycle,
    restoring: Boolean(row.restore_agent_name),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? undefined,
    current_run: currentRun,
  };
}

function titleOf(pane: PaneInfo): string {
  return pane.terminal_title_stripped ?? pane.label ?? pane.name ?? pane.display_agent ?? pane.agent ?? pane.pane_id;
}

function restoredAgentName(threadId: string): string {
  return `restored_${threadId.replace(/[^a-z0-9]/gi, "").slice(0, 20).toLowerCase()}`;
}
