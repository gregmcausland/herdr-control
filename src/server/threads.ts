import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentSessionReference,
  PaneInfo,
  ProjectInfo,
  RepositoryWorktreeInventory,
  SessionSnapshot,
  ThreadInfo,
  ThreadLifecycle,
  WorktreeInfo,
} from "../shared/protocol.js";

const RESTORE_CLAIM_TTL_MS = 90_000;

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
  project_id: string | null;
  worktree_id: string | null;
  title: string;
  agent_kind: string;
  agent_name: string | null;
  session_source: string | null;
  session_agent: string | null;
  session_kind: string | null;
  session_value: string | null;
  restore_agent_name: string | null;
  restore_requested_at: string | null;
  lifecycle: ThreadLifecycle;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface ProjectRow {
  project_id: string;
  repo_key: string;
  name: string;
  repo_root: string;
  created_at: string;
  updated_at: string;
}

interface WorktreeRow {
  worktree_id: string;
  project_id: string;
  checkout_path: string;
  label: string;
  branch: string | null;
  is_linked_worktree: number;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
  runtime_workspace_id: string | null;
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
  status_changed_at: string | null;
  last_work_duration_ms: number | null;
  updated_at: string;
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
  status_changed_at: string | null;
  last_work_duration_ms: number | null;
}

export class ThreadNotFoundError extends Error {}
export class ThreadNotRestorableError extends Error {}
export class ThreadNotDeletableError extends Error {}

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
      const stateDirectory = dirname(options.path);
      const createdDirectory = mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
      if (createdDirectory) chmodSync(stateDirectory, 0o700);
    }
    this.database = new DatabaseSync(options.path);
    if (options.path !== ":memory:") chmodSync(options.path, 0o600);
    this.retirePane = options.retirePane ?? (async () => "retired");
    this.restoreThread = options.restoreThread ?? (async () => {
      throw new ThreadNotRestorableError("Thread restore is not configured");
    });
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
    try {
      this.assertDatabaseHealthy();
      this.migrate();
      this.transaction(() => this.purgeNonRestorableArchivedThreads());
      this.assertDatabaseHealthy();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  reconcile(snapshot: SessionSnapshot): SessionSnapshot {
    const observedAt = this.now();
    const agentByPane = new Map((snapshot.agents ?? []).map((agent) => [agent.pane_id, agent]));
    const workspaceLabels = new Map(snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace.label]));
    const allObservations = snapshot.panes
      .map((pane) => ({ ...pane, ...agentByPane.get(pane.pane_id) }))
      .filter((pane): pane is PaneInfo & { agent: string } => Boolean(pane.agent));
    const retiredPaneIdsAtStart = new Set(this.retiredPaneIds());
    const observations = allObservations.filter((pane) => !retiredPaneIdsAtStart.has(pane.pane_id));
    const assignments = new Map<string, {
      threadId: string;
      runId: string;
      projectId?: string;
      worktreeId?: string;
      workingStartedAt?: string;
      lastWorkDurationMs?: number;
    }>();
    const placements = new Map<string, { projectId: string; worktreeId?: string }>();
    const observedPaneIds = new Set(allObservations.map((pane) => pane.pane_id));

    this.transaction(() => {
      this.reconcileProjects(snapshot, observedAt);
      this.backfillThreadProjects();
      for (const pane of snapshot.panes) {
        const placement = this.worktreeForPane(pane);
        if (placement) placements.set(pane.pane_id, placement);
      }
      this.releaseStaleRestoreClaims(
        new Set(observations.flatMap((pane) => pane.name ? [pane.name] : [])),
        observedAt,
      );
      const activeRuns = this.activeRuns();
      const activeByTerminal = new Map(activeRuns.map((run) => [run.terminal_id, run]));
      const matchedRunIds = new Set<string>();
      const endedRunIds = new Set<string>();
      const endedThreadIds = new Set<string>();
      const pending: Array<PaneInfo & { agent: string }> = [];
      const observedTerminalIds = new Set<string>();

      for (const observed of observations) {
        if (observedTerminalIds.has(observed.terminal_id)) {
          throw new Error(`Herdr reported terminal ${observed.terminal_id} more than once`);
        }
        observedTerminalIds.add(observed.terminal_id);

        let run = activeByTerminal.get(observed.terminal_id);
        const thread = run ? this.threadRow(run.thread_id) : undefined;
        if (run && thread && sameOccupant(thread, observed)) {
          matchedRunIds.add(run.run_id);
          this.updateThread(run.thread_id, observed, placements.get(observed.pane_id), observedAt);
          run = this.updateRun(
            run,
            observed,
            workspaceLabels.get(observed.workspace_id) ?? observed.workspace_id,
            observedAt,
          );
          assignments.set(observed.pane_id, assignmentFor(run, this.placementForThread(run.thread_id)));
          continue;
        }

        if (run) {
          this.endRun(run, observedAt);
          endedRunIds.add(run.run_id);
          endedThreadIds.add(run.thread_id);
        }
        pending.push(observed);
      }

      for (const run of activeRuns) {
        if (matchedRunIds.has(run.run_id) || endedRunIds.has(run.run_id)) continue;
        this.endRun(run, observedAt);
        endedThreadIds.add(run.thread_id);
      }

      for (const observed of pending) {
        const claimedThreadId = observed.name ? this.restoringThreadFor(observed.name) : undefined;
        let threadId = claimedThreadId;
        threadId ??= observed.agent_session ? this.inactiveThreadFor(observed.agent_session) : undefined;
        const existingThread = threadId ? this.threadRow(threadId) : undefined;
        if (!threadId) threadId = this.createThread(observed, placements.get(observed.pane_id), observedAt);

        let run = this.createRun(
          threadId,
          observed,
          workspaceLabels.get(observed.workspace_id) ?? observed.workspace_id,
          observedAt,
        );
        this.recordEvent(threadId, run.run_id, "run.started", observedAt);
        if (existingThread) this.activateThread(existingThread, run.run_id, observedAt, Boolean(claimedThreadId));
        this.updateThread(threadId, observed, placements.get(observed.pane_id), observedAt);
        run = this.updateRun(
          run,
          observed,
          workspaceLabels.get(observed.workspace_id) ?? observed.workspace_id,
          observedAt,
        );
        assignments.set(observed.pane_id, assignmentFor(run, this.placementForThread(threadId)));
      }

      for (const threadId of endedThreadIds) this.archiveThreadIfInactive(threadId, observedAt);
      this.archiveOrphanedOpenThreads(observedAt);

      const livePaneIds = new Set(snapshot.panes.map((pane) => pane.pane_id));
      for (const paneId of this.retiredPaneIds()) {
        if (!livePaneIds.has(paneId)) {
          this.database.prepare("DELETE FROM pane_retirements WHERE pane_id = ?").run(paneId);
        }
      }
    });

    const threads = this.list();
    const projects = this.listProjects();
    const worktrees = this.listWorktrees();
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
        .map((pane) => ({
          ...pane,
          ...paneProjectionFields(assignments.get(pane.pane_id), placements.get(pane.pane_id)),
        })),
      agents: snapshot.agents
        ?.filter((agent) => !hiddenPaneIds.has(agent.pane_id))
        .map((agent) => ({
          ...agent,
          ...paneProjectionFields(assignments.get(agent.pane_id), placements.get(agent.pane_id)),
        })),
      projects,
      worktrees,
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
        runs.started_at,
        runs.status_changed_at,
        runs.last_work_duration_ms
      FROM threads
      LEFT JOIN runs ON runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
      ORDER BY threads.created_at, threads.thread_id
    `).all() as unknown as ThreadWithRunRow[];
    return rows.map(threadInfoFromRow);
  }

  listProjects(): ProjectInfo[] {
    return (this.database.prepare(`
      SELECT * FROM projects ORDER BY name COLLATE NOCASE, repo_key
    `).all() as unknown as ProjectRow[]).map((row) => ({
      project_id: row.project_id,
      name: row.name,
      repo_key: row.repo_key,
      repo_root: row.repo_root,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  listWorktrees(): WorktreeInfo[] {
    const rows = this.database.prepare(`
      SELECT worktrees.*, worktree_runtimes.workspace_id AS runtime_workspace_id
      FROM worktrees
      LEFT JOIN worktree_runtimes
        ON worktree_runtimes.worktree_id = worktrees.worktree_id
        AND worktree_runtimes.ended_at IS NULL
      ORDER BY worktrees.created_at, worktrees.worktree_id
    `).all() as unknown as WorktreeRow[];
    return rows.map((row) => ({
      worktree_id: row.worktree_id,
      project_id: row.project_id,
      label: row.label,
      checkout_path: row.checkout_path,
      branch: row.branch ?? undefined,
      is_linked_worktree: Boolean(row.is_linked_worktree),
      runtime_workspace_id: row.runtime_workspace_id ?? undefined,
      removed_at: row.removed_at ?? undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  getProject(projectId: string): ProjectInfo | undefined {
    return this.listProjects().find((project) => project.project_id === projectId);
  }

  getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.listWorktrees().find((worktree) => worktree.worktree_id === worktreeId);
  }

  async archive(threadId: string): Promise<ThreadInfo> {
    const archivedAt = this.now();
    const existing = this.thread(threadId);
    if (!existing) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    if (!existing.agent_session) {
      throw new ThreadNotRestorableError("Threads without a resumable agent session must be deleted");
    }
    const newlyArchived = existing.lifecycle !== "archived";

    if (newlyArchived) {
      this.transaction(() => {
        this.database.prepare(`
          UPDATE threads
          SET lifecycle = 'archived', archived_at = ?, restore_agent_name = NULL,
              restore_requested_at = NULL, updated_at = ?
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

  /** Permanently removes a non-restorable Thread while retiring its Herdr pane independently. */
  deleteThread(threadId: string): void {
    const existing = this.thread(threadId);
    if (!existing) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    if (existing.agent_session) {
      throw new ThreadNotDeletableError("This Thread now has a resumable agent session and must be archived");
    }
    const paneId = existing.current_run?.pane_id;
    this.transaction(() => {
      if (paneId) this.recordPaneRetirement(paneId);
      this.deleteThreadRecords(threadId);
    });
    if (paneId) void this.requestPaneRetirement(paneId).catch(() => undefined);
  }

  /** Removes a transient pane from Control while Herdr retirement completes independently. */
  deletePane(paneId: string): void {
    this.recordPaneRetirement(paneId);
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
        SET restore_agent_name = ?, restore_requested_at = ?, updated_at = ?
        WHERE thread_id = ?
      `).run(agentName, restoredAt, restoredAt, threadId);
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
          SET restore_agent_name = NULL, restore_requested_at = NULL, updated_at = ?
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

  /** Reconciles durable repository identity before Runs are assigned to Threads. */
  private reconcileProjects(snapshot: SessionSnapshot, observedAt: string): void {
    const liveWorkspaceIds = new Set(snapshot.workspaces.map((workspace) => workspace.workspace_id));
    const activeRuntimes = this.database.prepare(`
      SELECT runtime_id, workspace_id FROM worktree_runtimes WHERE ended_at IS NULL
    `).all() as unknown as Array<{ runtime_id: string; workspace_id: string }>;
    for (const runtime of activeRuntimes) {
      if (liveWorkspaceIds.has(runtime.workspace_id)) continue;
      this.database.prepare(`
        UPDATE worktree_runtimes SET ended_at = ?, last_seen_at = ? WHERE runtime_id = ?
      `).run(observedAt, observedAt, runtime.runtime_id);
    }

    const inventories = snapshot.repositories ?? [];
    const repoKeys = new Set<string>();
    for (const inventory of inventories) {
      if (repoKeys.has(inventory.repo_key)) {
        throw new Error(`Herdr reported repository ${inventory.repo_key} more than once`);
      }
      repoKeys.add(inventory.repo_key);
      const checkoutPaths = new Set<string>();
      for (const worktree of inventory.worktrees) {
        if (checkoutPaths.has(worktree.path)) {
          throw new Error(`Herdr reported checkout ${worktree.path} more than once`);
        }
        checkoutPaths.add(worktree.path);
      }
    }
    for (const inventory of inventories) this.reconcileRepository(inventory, liveWorkspaceIds, observedAt);
  }

  private reconcileRepository(
    inventory: RepositoryWorktreeInventory,
    liveWorkspaceIds: Set<string>,
    observedAt: string,
  ): void {
    let project = this.database.prepare("SELECT * FROM projects WHERE repo_key = ?")
      .get(inventory.repo_key) as unknown as ProjectRow | undefined;
    if (!project) {
      const projectId = this.createId();
      this.database.prepare(`
        INSERT INTO projects (project_id, repo_key, name, repo_root, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(projectId, inventory.repo_key, inventory.repo_name, inventory.repo_root, observedAt, observedAt);
      project = this.database.prepare("SELECT * FROM projects WHERE project_id = ?")
        .get(projectId) as unknown as ProjectRow;
    } else {
      this.database.prepare(`
        UPDATE projects SET name = ?, repo_root = ?, updated_at = ? WHERE project_id = ?
      `).run(inventory.repo_name, inventory.repo_root, observedAt, project.project_id);
    }

    const observedPaths = new Set(inventory.worktrees.map((worktree) => worktree.path));
    const existing = this.database.prepare("SELECT * FROM worktrees WHERE project_id = ?")
      .all(project.project_id) as unknown as WorktreeRow[];
    for (const worktree of existing) {
      if (observedPaths.has(worktree.checkout_path)) continue;
      this.database.prepare(`
        UPDATE worktrees SET removed_at = COALESCE(removed_at, ?), updated_at = ? WHERE worktree_id = ?
      `).run(observedAt, observedAt, worktree.worktree_id);
      this.endWorktreeRuntime(worktree.worktree_id, observedAt);
    }

    for (const observed of inventory.worktrees) {
      let worktree = this.database.prepare(`
        SELECT * FROM worktrees WHERE project_id = ? AND checkout_path = ?
      `).get(project.project_id, observed.path) as unknown as WorktreeRow | undefined;
      if (!worktree) {
        const worktreeId = this.createId();
        this.database.prepare(`
          INSERT INTO worktrees (
            worktree_id, project_id, checkout_path, label, branch,
            is_linked_worktree, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          worktreeId,
          project.project_id,
          observed.path,
          observed.label,
          observed.branch ?? null,
          observed.is_linked_worktree ? 1 : 0,
          observedAt,
          observedAt,
        );
        worktree = this.database.prepare("SELECT * FROM worktrees WHERE worktree_id = ?")
          .get(worktreeId) as unknown as WorktreeRow;
      } else {
        this.database.prepare(`
          UPDATE worktrees SET
            label = ?, branch = ?, is_linked_worktree = ?, removed_at = NULL, updated_at = ?
          WHERE worktree_id = ?
        `).run(
          observed.label,
          observed.branch ?? null,
          observed.is_linked_worktree ? 1 : 0,
          observedAt,
          worktree.worktree_id,
        );
      }

      if (observed.open_workspace_id && liveWorkspaceIds.has(observed.open_workspace_id)) {
        this.activateWorktreeRuntime(worktree.worktree_id, observed.open_workspace_id, observedAt);
      } else {
        this.endWorktreeRuntime(worktree.worktree_id, observedAt);
      }
    }
  }

  private activateWorktreeRuntime(worktreeId: string, workspaceId: string, observedAt: string): void {
    const current = this.database.prepare(`
      SELECT runtime_id, worktree_id, workspace_id
      FROM worktree_runtimes
      WHERE ended_at IS NULL AND worktree_id = ?
    `).all(worktreeId) as unknown as Array<{
      runtime_id: string;
      worktree_id: string;
      workspace_id: string;
    }>;
    const matching = current.find(
      (runtime) => runtime.worktree_id === worktreeId && runtime.workspace_id === workspaceId,
    );
    for (const runtime of current) {
      if (runtime === matching) continue;
      this.database.prepare(`
        UPDATE worktree_runtimes SET ended_at = ?, last_seen_at = ? WHERE runtime_id = ?
      `).run(observedAt, observedAt, runtime.runtime_id);
    }
    if (matching) {
      this.database.prepare("UPDATE worktree_runtimes SET last_seen_at = ? WHERE runtime_id = ?")
        .run(observedAt, matching.runtime_id);
      return;
    }
    this.database.prepare(`
      INSERT INTO worktree_runtimes (
        runtime_id, worktree_id, workspace_id, started_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(this.createId(), worktreeId, workspaceId, observedAt, observedAt);
  }

  private endWorktreeRuntime(worktreeId: string, observedAt: string): void {
    this.database.prepare(`
      UPDATE worktree_runtimes SET ended_at = ?, last_seen_at = ?
      WHERE worktree_id = ? AND ended_at IS NULL
    `).run(observedAt, observedAt, worktreeId);
  }

  private worktreeForPane(pane: PaneInfo): { projectId: string; worktreeId?: string } | undefined {
    const worktrees = this.database.prepare(`
      SELECT worktrees.*, worktree_runtimes.workspace_id AS runtime_workspace_id
      FROM worktrees
      LEFT JOIN worktree_runtimes
        ON worktree_runtimes.worktree_id = worktrees.worktree_id
        AND worktree_runtimes.ended_at IS NULL
      WHERE worktrees.removed_at IS NULL
    `).all() as unknown as WorktreeRow[];
    const cwd = pane.foreground_cwd ?? pane.cwd;
    const byPath = cwd
      ? worktrees
          .filter((worktree) => pathContains(worktree.checkout_path, cwd))
          .sort((left, right) => right.checkout_path.length - left.checkout_path.length)[0]
      : undefined;
    const runtimeMatches = worktrees.filter((worktree) => worktree.runtime_workspace_id === pane.workspace_id);
    const match = byPath ?? (runtimeMatches.length === 1 ? runtimeMatches[0] : undefined);
    return match ? { projectId: match.project_id, worktreeId: match.worktree_id } : undefined;
  }

  private backfillThreadProjects(): void {
    const worktrees = this.database.prepare(`
      SELECT worktree_id, project_id, checkout_path FROM worktrees
      ORDER BY length(checkout_path) DESC
    `).all() as unknown as Array<{ worktree_id: string; project_id: string; checkout_path: string }>;
    const threads = this.database.prepare(`
      SELECT threads.thread_id, (
        SELECT runs.cwd FROM runs
        WHERE runs.thread_id = threads.thread_id AND runs.cwd IS NOT NULL
        ORDER BY runs.started_at DESC, runs.run_id DESC
        LIMIT 1
      ) AS cwd
      FROM threads
      WHERE threads.project_id IS NULL
    `).all() as unknown as Array<{ thread_id: string; cwd: string | null }>;
    for (const thread of threads) {
      if (!thread.cwd) continue;
      const worktree = worktrees.find((candidate) => pathContains(candidate.checkout_path, thread.cwd!));
      if (!worktree) continue;
      this.database.prepare(`
        UPDATE threads SET project_id = ?, worktree_id = COALESCE(worktree_id, ?) WHERE thread_id = ?
      `).run(worktree.project_id, worktree.worktree_id, thread.thread_id);
    }
  }

  private placementForThread(threadId: string): { projectId: string; worktreeId?: string } | undefined {
    const row = this.database.prepare(`
      SELECT COALESCE(threads.project_id, worktrees.project_id) AS project_id, threads.worktree_id
      FROM threads
      LEFT JOIN worktrees ON worktrees.worktree_id = threads.worktree_id
      WHERE threads.thread_id = ?
    `).get(threadId) as { project_id: string | null; worktree_id: string | null } | undefined;
    return row?.project_id
      ? { projectId: row.project_id, worktreeId: row.worktree_id ?? undefined }
      : undefined;
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        repo_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worktrees (
        worktree_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id),
        checkout_path TEXT NOT NULL,
        label TEXT NOT NULL,
        branch TEXT,
        is_linked_worktree INTEGER NOT NULL DEFAULT 0,
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, checkout_path)
      );

      CREATE TABLE IF NOT EXISTS worktree_runtimes (
        runtime_id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL REFERENCES worktrees(worktree_id),
        workspace_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS worktree_runtimes_one_active_worktree
      ON worktree_runtimes(worktree_id) WHERE ended_at IS NULL;

      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(project_id),
        worktree_id TEXT REFERENCES worktrees(worktree_id),
        title TEXT NOT NULL,
        agent_kind TEXT NOT NULL,
        agent_name TEXT,
        session_source TEXT,
        session_agent TEXT,
        session_kind TEXT,
        session_value TEXT,
        restore_agent_name TEXT,
        restore_requested_at TEXT,
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
        pane_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        cwd TEXT,
        agent_status TEXT,
        started_at TEXT NOT NULL,
        status_changed_at TEXT,
        last_work_duration_ms INTEGER,
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
    this.database.exec("DROP INDEX IF EXISTS worktree_runtimes_one_active_workspace");

    const columns = this.database.prepare("PRAGMA table_info(threads)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "restore_agent_name")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN restore_agent_name TEXT");
    }
    if (!columns.some((column) => column.name === "restore_requested_at")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN restore_requested_at TEXT");
    }
    if (!columns.some((column) => column.name === "worktree_id")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN worktree_id TEXT REFERENCES worktrees(worktree_id)");
    }
    if (!columns.some((column) => column.name === "project_id")) {
      this.database.exec("ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(project_id)");
    }
    this.database.exec(`
      UPDATE threads
      SET project_id = (
        SELECT worktrees.project_id FROM worktrees
        WHERE worktrees.worktree_id = threads.worktree_id
      )
      WHERE project_id IS NULL AND worktree_id IS NOT NULL;
    `);
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS threads_one_restore_claim
      ON threads(restore_agent_name) WHERE restore_agent_name IS NOT NULL;
    `);
    const runColumns = this.database.prepare("PRAGMA table_info(runs)").all() as unknown as Array<{ name: string }>;
    if (!runColumns.some((column) => column.name === "status_changed_at")) {
      this.database.exec("ALTER TABLE runs ADD COLUMN status_changed_at TEXT");
    }
    if (!runColumns.some((column) => column.name === "last_work_duration_ms")) {
      this.database.exec("ALTER TABLE runs ADD COLUMN last_work_duration_ms INTEGER");
    }
    const runIndexes = this.database.prepare("PRAGMA index_list(runs)").all() as unknown as Array<{ origin: string }>;
    if (runIndexes.some((index) => index.origin === "u")) this.rebuildLegacyRunsTable();
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_per_thread
      ON runs(thread_id) WHERE ended_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS runs_one_active_per_terminal
      ON runs(terminal_id) WHERE ended_at IS NULL;
    `);
  }

  private assertDatabaseHealthy(): void {
    const integrity = this.database.prepare("PRAGMA integrity_check").all() as unknown as Array<{
      integrity_check: string;
    }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error(`Control state database failed integrity check: ${integrity.map((row) => row.integrity_check).join(", ")}`);
    }
    const foreignKeyFailures = this.database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length) {
      throw new Error("Control state database contains broken foreign-key references");
    }
  }

  private rebuildLegacyRunsTable(): void {
    this.database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE runs_next (
            run_id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(thread_id),
            workspace_id TEXT NOT NULL,
            workspace_label TEXT NOT NULL,
            tab_id TEXT NOT NULL,
            pane_id TEXT NOT NULL,
            terminal_id TEXT NOT NULL,
            cwd TEXT,
            agent_status TEXT,
            started_at TEXT NOT NULL,
            status_changed_at TEXT,
            last_work_duration_ms INTEGER,
            updated_at TEXT NOT NULL,
            ended_at TEXT
          );

          INSERT INTO runs_next SELECT
            run_id, thread_id, workspace_id, workspace_label, tab_id, pane_id,
            terminal_id, cwd, agent_status, started_at, status_changed_at,
            last_work_duration_ms, updated_at, ended_at
          FROM runs;

          DROP TABLE runs;
          ALTER TABLE runs_next RENAME TO runs;
        `);
      });
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON");
    }
  }

  private createThread(
    pane: PaneInfo,
    placement: { projectId: string; worktreeId?: string } | undefined,
    createdAt: string,
  ): string {
    const threadId = this.createId();
    const session = pane.agent_session;
    this.database.prepare(`
      INSERT INTO threads (
        thread_id, project_id, worktree_id, title, agent_kind, agent_name,
        session_source, session_agent, session_kind, session_value,
        lifecycle, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      threadId,
      placement?.projectId ?? null,
      placement?.worktreeId ?? null,
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
        terminal_id, cwd, agent_status, started_at, status_changed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      startedAt,
    );
    return this.activeRunForPane(pane.pane_id)!;
  }

  private updateThread(
    threadId: string,
    pane: PaneInfo,
    placement: { projectId: string; worktreeId?: string } | undefined,
    updatedAt: string,
  ): void {
    const session = pane.agent_session;
    this.database.prepare(`
      UPDATE threads SET
        project_id = COALESCE(project_id, ?),
        worktree_id = COALESCE(worktree_id, ?),
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
      placement?.projectId ?? null,
      placement?.worktreeId ?? null,
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

  private updateRun(run: RunRow, pane: PaneInfo, workspaceLabel: string, updatedAt: string): RunRow {
    const nextStatus = pane.agent_status ?? null;
    let statusChangedAt = run.status_changed_at ?? updatedAt;
    let lastWorkDurationMs = run.last_work_duration_ms;
    if (run.agent_status !== nextStatus) {
      if (run.agent_status === "working") {
        lastWorkDurationMs = elapsedMilliseconds(statusChangedAt, updatedAt);
      }
      statusChangedAt = updatedAt;
    }
    this.database.prepare(`
      UPDATE runs SET
        workspace_id = ?,
        workspace_label = ?,
        tab_id = ?,
        pane_id = ?,
        terminal_id = ?,
        cwd = ?,
        agent_status = ?,
        status_changed_at = ?,
        last_work_duration_ms = ?,
        updated_at = ?
      WHERE run_id = ?
    `).run(
      pane.workspace_id,
      workspaceLabel,
      pane.tab_id,
      pane.pane_id,
      pane.terminal_id,
      pane.foreground_cwd ?? pane.cwd ?? null,
      nextStatus,
      statusChangedAt,
      lastWorkDurationMs,
      updatedAt,
      run.run_id,
    );
    return this.run(run.run_id)!;
  }

  private inactiveThreadFor(session: AgentSessionReference): string | undefined {
    const row = this.database.prepare(`
      SELECT threads.thread_id
      FROM threads
      WHERE
        session_source = ?
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

  private activateThread(thread: ThreadRow, runId: string, observedAt: string, claimedRestore: boolean): void {
    this.database.prepare(`
      UPDATE threads
      SET lifecycle = 'open', archived_at = NULL, restore_agent_name = NULL,
          restore_requested_at = NULL, updated_at = ?
      WHERE thread_id = ?
    `).run(observedAt, thread.thread_id);
    if (claimedRestore || thread.lifecycle === "archived") {
      this.recordEvent(
        thread.thread_id,
        runId,
        claimedRestore ? "thread.restored" : "thread.reactivated",
        observedAt,
      );
    }
  }

  private endRun(run: RunRow, observedAt: string): void {
    const lastWorkDurationMs = run.agent_status === "working"
      ? elapsedMilliseconds(run.status_changed_at ?? run.updated_at, observedAt)
      : run.last_work_duration_ms;
    this.database.prepare(`
      UPDATE runs
      SET ended_at = ?, updated_at = ?, last_work_duration_ms = ?
      WHERE run_id = ? AND ended_at IS NULL
    `).run(observedAt, observedAt, lastWorkDurationMs, run.run_id);
    this.database.prepare("UPDATE threads SET updated_at = ? WHERE thread_id = ?")
      .run(observedAt, run.thread_id);
    this.recordEvent(run.thread_id, run.run_id, "run.ended", observedAt);
  }

  private archiveThreadIfInactive(threadId: string, observedAt: string): void {
    if (this.activeRunForThread(threadId)) return;
    const thread = this.threadRow(threadId);
    if (!thread || thread.lifecycle === "archived") return;
    if (!hasSessionReference(thread)) {
      this.deleteThreadRecords(threadId);
      return;
    }
    this.database.prepare(`
      UPDATE threads
      SET lifecycle = 'archived', archived_at = ?, restore_agent_name = NULL,
          restore_requested_at = NULL, updated_at = ?
      WHERE thread_id = ?
    `).run(observedAt, observedAt, threadId);
    this.recordEvent(threadId, null, "thread.auto_archived", observedAt);
  }

  private archiveOrphanedOpenThreads(observedAt: string): void {
    const rows = this.database.prepare(`
      SELECT thread_id FROM threads
      WHERE lifecycle = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM runs
          WHERE runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
        )
    `).all() as unknown as Array<{ thread_id: string }>;
    for (const row of rows) this.archiveThreadIfInactive(row.thread_id, observedAt);
  }

  private restoringThreadFor(agentName: string): string | undefined {
    const row = this.database.prepare(`
      SELECT thread_id FROM threads
      WHERE lifecycle = 'archived' AND restore_agent_name = ?
      LIMIT 1
    `).get(agentName) as { thread_id?: string } | undefined;
    return row?.thread_id;
  }

  private releaseStaleRestoreClaims(observedAgentNames: Set<string>, observedAt: string): void {
    const cutoff = Date.parse(observedAt) - RESTORE_CLAIM_TTL_MS;
    const claims = this.database.prepare(`
      SELECT thread_id, restore_agent_name, restore_requested_at, updated_at
      FROM threads
      WHERE restore_agent_name IS NOT NULL
    `).all() as unknown as Array<{
      thread_id: string;
      restore_agent_name: string;
      restore_requested_at: string | null;
      updated_at: string;
    }>;
    for (const claim of claims) {
      if (observedAgentNames.has(claim.restore_agent_name)) continue;
      const requestedAt = claim.restore_requested_at ?? claim.updated_at;
      if (Date.parse(requestedAt) > cutoff) continue;
      this.database.prepare(`
        UPDATE threads
        SET restore_agent_name = NULL, restore_requested_at = NULL, updated_at = ?
        WHERE thread_id = ?
      `).run(observedAt, claim.thread_id);
      this.recordEvent(claim.thread_id, null, "thread.restore_expired", observedAt);
    }
  }

  private activeRunForPane(paneId: string): RunRow | undefined {
    return this.database.prepare("SELECT * FROM runs WHERE pane_id = ? AND ended_at IS NULL")
      .get(paneId) as unknown as RunRow | undefined;
  }

  private activeRunForThread(threadId: string): RunRow | undefined {
    return this.database.prepare("SELECT * FROM runs WHERE thread_id = ? AND ended_at IS NULL")
      .get(threadId) as unknown as RunRow | undefined;
  }

  private run(runId: string): RunRow | undefined {
    return this.database.prepare("SELECT * FROM runs WHERE run_id = ?")
      .get(runId) as unknown as RunRow | undefined;
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

  private threadRow(threadId: string): ThreadRow | undefined {
    return this.database.prepare("SELECT * FROM threads WHERE thread_id = ?")
      .get(threadId) as unknown as ThreadRow | undefined;
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
        runs.started_at,
        runs.status_changed_at,
        runs.last_work_duration_ms
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

  /** Removes legacy archive entries that never gained a resumable agent session. */
  private purgeNonRestorableArchivedThreads(): void {
    const rows = this.database.prepare(`
      SELECT threads.thread_id, runs.pane_id
      FROM threads
      LEFT JOIN runs ON runs.thread_id = threads.thread_id AND runs.ended_at IS NULL
      WHERE threads.lifecycle = 'archived'
        AND (
          threads.session_source IS NULL OR threads.session_agent IS NULL
          OR threads.session_kind IS NULL OR threads.session_value IS NULL
        )
    `).all() as unknown as Array<{ thread_id: string; pane_id: string | null }>;
    for (const row of rows) {
      if (row.pane_id) this.recordPaneRetirement(row.pane_id);
      this.deleteThreadRecords(row.thread_id);
    }
  }

  private deleteThreadRecords(threadId: string): void {
    this.database.prepare("DELETE FROM thread_events WHERE thread_id = ?").run(threadId);
    this.database.prepare("DELETE FROM runs WHERE thread_id = ?").run(threadId);
    this.database.prepare("DELETE FROM threads WHERE thread_id = ?").run(threadId);
  }

  private recordPaneRetirement(paneId: string): void {
    this.database.prepare(`
      INSERT INTO pane_retirements (pane_id, requested_at)
      VALUES (?, ?)
      ON CONFLICT(pane_id) DO NOTHING
    `).run(paneId, this.now());
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
        working_started_at: row.agent_status === "working" ? row.status_changed_at ?? undefined : undefined,
        last_work_duration_ms: row.last_work_duration_ms ?? undefined,
      }
    : undefined;
  return {
    thread_id: row.thread_id,
    project_id: row.project_id ?? undefined,
    worktree_id: row.worktree_id ?? undefined,
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
  return pane.label ?? pane.terminal_title_stripped ?? pane.name ?? pane.display_agent ?? pane.agent ?? pane.pane_id;
}

function sameOccupant(thread: ThreadRow, pane: PaneInfo & { agent: string }): boolean {
  if (thread.agent_kind !== pane.agent) return false;

  const storedSession = thread.session_source && thread.session_agent && thread.session_kind && thread.session_value
    ? [thread.session_source, thread.session_agent, thread.session_kind, thread.session_value]
    : undefined;
  const observedSession = pane.agent_session
    ? [pane.agent_session.source, pane.agent_session.agent, pane.agent_session.kind, pane.agent_session.value]
    : undefined;
  if (!storedSession || !observedSession) return true;
  return storedSession.every((value, index) => value === observedSession[index]);
}

function hasSessionReference(thread: ThreadRow): boolean {
  return Boolean(thread.session_source && thread.session_agent && thread.session_kind && thread.session_value);
}

function assignmentFor(
  run: RunRow,
  placement: { projectId: string; worktreeId?: string } | undefined,
): {
  threadId: string;
  runId: string;
  projectId?: string;
  worktreeId?: string;
  workingStartedAt?: string;
  lastWorkDurationMs?: number;
} {
  return {
    threadId: run.thread_id,
    runId: run.run_id,
    projectId: placement?.projectId,
    worktreeId: placement?.worktreeId,
    workingStartedAt: run.agent_status === "working" ? run.status_changed_at ?? undefined : undefined,
    lastWorkDurationMs: run.last_work_duration_ms ?? undefined,
  };
}

function placementFields(
  placement: { projectId: string; worktreeId?: string } | undefined,
): { project_id?: string; worktree_id?: string } {
  return placement
    ? { project_id: placement.projectId, worktree_id: placement.worktreeId }
    : {};
}

function paneProjectionFields(
  assignment: {
    threadId: string;
    runId: string;
    projectId?: string;
    worktreeId?: string;
    workingStartedAt?: string;
    lastWorkDurationMs?: number;
  } | undefined,
  placement: { projectId: string; worktreeId?: string } | undefined,
): {
  thread_id?: string;
  run_id?: string;
  project_id?: string;
  worktree_id?: string;
  working_started_at?: string;
  last_work_duration_ms?: number;
} {
  return assignment
    ? {
        thread_id: assignment.threadId,
        run_id: assignment.runId,
        project_id: assignment.projectId,
        worktree_id: assignment.worktreeId,
        working_started_at: assignment.workingStartedAt,
        last_work_duration_ms: assignment.lastWorkDurationMs,
      }
    : placementFields(placement);
}

function pathContains(root: string, candidate: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, "");
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

function restoredAgentName(threadId: string): string {
  return `restored_${threadId.replace(/[^a-z0-9]/gi, "").slice(0, 20).toLowerCase()}`;
}

function elapsedMilliseconds(startedAt: string, endedAt: string): number {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}
