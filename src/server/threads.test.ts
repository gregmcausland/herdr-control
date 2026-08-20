import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryWorktreeInventory, SessionSnapshot } from "../shared/protocol";
import { ThreadManager } from "./threads";

function snapshot(paneId = "w1:p1", sessionValue: string | null = "agent-session-1"): SessionSnapshot {
  const pane = {
    pane_id: paneId,
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: `term-${paneId}`,
    terminal_title_stripped: "Build durable threads",
    cwd: "/projects/control",
    agent: "codex",
    agent_status: "idle",
    agent_session: sessionValue
      ? {
          source: "codex-integration",
          agent: "codex",
          kind: "id",
          value: sessionValue,
        }
      : undefined,
    focused: true,
  };
  return {
    version: "0.8.0",
    protocol: 19,
    workspaces: [{ workspace_id: "w1", label: "Control", number: 1, tab_count: 1, pane_count: 1, focused: true }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Main", number: 1, pane_count: 1, focused: true }],
    panes: [pane],
    agents: [pane],
  };
}

function emptySnapshot(): SessionSnapshot {
  return { ...snapshot(), panes: [], agents: [] };
}

function repository(
  worktrees: RepositoryWorktreeInventory["worktrees"] = [{
    path: "/projects/control",
    label: "control",
    branch: "main",
    is_bare: false,
    is_detached: false,
    is_linked_worktree: false,
    is_prunable: false,
    open_workspace_id: "w1",
  }],
): RepositoryWorktreeInventory {
  return {
    repo_key: "/projects/control/.git",
    repo_name: "control",
    repo_root: "/projects/control",
    source_checkout_path: "/projects/control",
    source_workspace_id: "w1",
    worktrees,
  };
}

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

describe("ThreadManager", () => {
  it("does not change permissions on an existing state directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-state-parent-"));
    const path = join(directory, "control.db");
    try {
      chmodSync(directory, 0o755);
      const threads = new ThreadManager({ path });
      threads.close();

      expect(statSync(directory).mode & 0o777).toBe(0o755);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adopts an agent pane once and projects durable IDs onto it", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });

    const first = threads.reconcile(snapshot());
    const second = threads.reconcile(snapshot());

    expect(first.threads).toHaveLength(1);
    expect(second.threads).toHaveLength(1);
    expect(second.threads?.[0].thread_id).toBe(first.threads?.[0].thread_id);
    expect(second.threads?.[0].current_run?.run_id).toBe(first.threads?.[0].current_run?.run_id);
    expect(second.panes[0]).toMatchObject({
      thread_id: first.threads?.[0].thread_id,
      run_id: first.threads?.[0].current_run?.run_id,
    });
    threads.close();
  });

  it("projects durable Project and Worktree identity onto panes and Threads", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
    const observed = snapshot();
    observed.repositories = [repository()];

    const reconciled = threads.reconcile(observed);

    expect(reconciled.projects).toHaveLength(1);
    expect(reconciled.projects?.[0]).toMatchObject({ name: "control", repo_key: "/projects/control/.git" });
    expect(reconciled.worktrees?.[0]).toMatchObject({
      project_id: reconciled.projects?.[0].project_id,
      checkout_path: "/projects/control",
      runtime_workspace_id: "w1",
    });
    expect(reconciled.panes[0]).toMatchObject({
      project_id: reconciled.projects?.[0].project_id,
      worktree_id: reconciled.worktrees?.[0].worktree_id,
    });
    expect(reconciled.agents?.[0]).toMatchObject({
      project_id: reconciled.projects?.[0].project_id,
      worktree_id: reconciled.worktrees?.[0].worktree_id,
      thread_id: reconciled.threads?.[0].thread_id,
    });
    expect(reconciled.threads?.[0].worktree_id).toBe(reconciled.worktrees?.[0].worktree_id);
    expect(reconciled.threads?.[0].project_id).toBe(reconciled.projects?.[0].project_id);
    threads.close();
  });

  it("keeps durable Projects and Worktrees after their Herdr runtime closes", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
    const observed = snapshot();
    observed.repositories = [repository()];
    const first = threads.reconcile(observed);

    const closed = emptySnapshot();
    closed.workspaces = [];
    closed.tabs = [];
    closed.repositories = [repository(repository().worktrees.map((worktree) => ({
      ...worktree,
      open_workspace_id: undefined,
    })))];
    const reconciled = threads.reconcile(closed);

    expect(reconciled.projects?.[0].project_id).toBe(first.projects?.[0].project_id);
    expect(reconciled.worktrees?.[0]).toMatchObject({
      worktree_id: first.worktrees?.[0].worktree_id,
      runtime_workspace_id: undefined,
    });
    expect(reconciled.threads?.[0]).toMatchObject({ lifecycle: "archived" });
    threads.close();
  });

  it("retains removed Worktrees as history instead of deleting them", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
    const observed = snapshot();
    observed.repositories = [repository([
      ...repository().worktrees,
      {
        path: "/projects/control-feature",
        label: "feature",
        branch: "feature",
        is_bare: false,
        is_detached: false,
        is_linked_worktree: true,
        is_prunable: false,
      },
    ])];
    const first = threads.reconcile(observed);
    const featureId = first.worktrees?.find((worktree) => worktree.label === "feature")?.worktree_id;

    const withoutFeature = snapshot();
    withoutFeature.repositories = [repository()];
    const reconciled = threads.reconcile(withoutFeature);

    expect(reconciled.worktrees?.find((worktree) => worktree.worktree_id === featureId)?.removed_at)
      .toBe("2026-08-20T12:00:00.000Z");
    threads.close();
  });

  it("assigns a pane to the most specific checkout path", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
    const observed = snapshot();
    observed.panes[0].cwd = "/projects/control/.worktrees/feature/src";
    observed.agents![0].cwd = observed.panes[0].cwd;
    observed.repositories = [repository([
      ...repository().worktrees,
      {
        path: "/projects/control/.worktrees/feature",
        label: "feature",
        branch: "feature",
        is_bare: false,
        is_detached: false,
        is_linked_worktree: true,
        is_prunable: false,
        open_workspace_id: "w1",
      },
    ])];

    const reconciled = threads.reconcile(observed);

    expect(reconciled.worktrees?.find((worktree) => worktree.worktree_id === reconciled.panes[0].worktree_id)?.label)
      .toBe("feature");
    threads.close();
  });

  it("persists the latest working period across status changes", () => {
    let observedAt = "2026-08-19T12:00:00.000Z";
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => observedAt });
    threads.reconcile(snapshot());

    observedAt = "2026-08-19T12:01:00.000Z";
    const working = snapshot();
    working.panes[0].agent_status = "working";
    working.agents![0].agent_status = "working";
    const active = threads.reconcile(working);
    expect(active.panes[0].working_started_at).toBe(observedAt);

    observedAt = "2026-08-19T12:03:05.000Z";
    const done = snapshot();
    done.panes[0].agent_status = "done";
    done.agents![0].agent_status = "done";
    const completed = threads.reconcile(done);

    expect(completed.panes[0]).toMatchObject({
      working_started_at: undefined,
      last_work_duration_ms: 125_000,
    });
    expect(completed.threads?.[0].current_run?.last_work_duration_ms).toBe(125_000);
    threads.close();
  });

  it("auto-archives a vanished Run and reactivates the same Thread when its session returns", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
    const adopted = threads.reconcile(snapshot());
    const threadId = adopted.threads![0].thread_id;
    const firstRunId = adopted.threads![0].current_run!.run_id;

    const stopped = threads.reconcile(emptySnapshot());
    expect(stopped.threads?.[0]).toMatchObject({ thread_id: threadId, lifecycle: "archived" });
    expect(stopped.threads?.[0].current_run).toBeUndefined();

    const resumed = threads.reconcile(snapshot("w1:p2"));
    expect(resumed.threads?.[0].thread_id).toBe(threadId);
    expect(resumed.threads?.[0].lifecycle).toBe("open");
    expect(resumed.threads?.[0].current_run?.run_id).not.toBe(firstRunId);
    expect(resumed.panes[0].thread_id).toBe(threadId);
    threads.close();
  });

  it("starts a new Thread when a different agent session replaces a pane occupant", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
    const first = threads.reconcile(snapshot("w1:p1", "session-a"));

    const replacement = threads.reconcile(snapshot("w1:p1", "session-b"));
    const original = replacement.threads?.find((thread) => thread.thread_id === first.threads?.[0].thread_id);
    const current = replacement.threads?.find((thread) => thread.current_run);

    expect(replacement.threads).toHaveLength(2);
    expect(original).toMatchObject({ lifecycle: "archived", agent_session: { value: "session-a" } });
    expect(current).toMatchObject({ lifecycle: "open", agent_session: { value: "session-b" } });
    expect(replacement.panes[0].thread_id).toBe(current?.thread_id);
    threads.close();
  });

  it("allows a pane locator to be reused after its previous Run ends", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
    threads.reconcile(snapshot("w1:p1", "session-a"));
    threads.reconcile(emptySnapshot());

    const replacement = threads.reconcile(snapshot("w1:p1", "session-b"));

    expect(replacement.threads).toHaveLength(2);
    expect(replacement.panes[0].thread_id).toBe(
      replacement.threads?.find((thread) => thread.agent_session?.value === "session-b")?.thread_id,
    );
    threads.close();
  });

  it("migrates legacy databases that made historical pane locators unique", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-legacy-runs-"));
    const path = join(directory, "control.db");
    try {
      const database = new DatabaseSync(path);
      database.exec(`
        CREATE TABLE threads (
          thread_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          agent_kind TEXT NOT NULL,
          agent_name TEXT,
          session_source TEXT,
          session_agent TEXT,
          session_kind TEXT,
          session_value TEXT,
          restore_agent_name TEXT,
          lifecycle TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );
        CREATE TABLE runs (
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
        INSERT INTO threads VALUES (
          'legacy-thread', 'Legacy', 'codex', NULL,
          'codex-integration', 'codex', 'id', 'session-a', NULL,
          'archived', '2026-08-19T10:00:00.000Z', '2026-08-19T11:00:00.000Z', '2026-08-19T11:00:00.000Z'
        );
        INSERT INTO runs VALUES (
          'legacy-run', 'legacy-thread', 'w1', 'Control', 'w1:t1', 'w1:p1',
          'legacy-terminal', '/projects/control', 'idle',
          '2026-08-19T10:00:00.000Z', '2026-08-19T11:00:00.000Z', '2026-08-19T11:00:00.000Z'
        );
        INSERT INTO threads VALUES (
          'legacy-disposable', 'Disposable', 'codex', NULL,
          NULL, NULL, NULL, NULL, NULL,
          'archived', '2026-08-19T10:00:00.000Z', '2026-08-19T11:00:00.000Z', '2026-08-19T11:00:00.000Z'
        );
      `);
      database.close();

      const threads = new ThreadManager({ path, createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
      const reconciled = threads.reconcile(snapshot("w1:p1", "session-b"));

      expect(reconciled.threads).toHaveLength(2);
      expect(reconciled.threads?.some((thread) => thread.thread_id === "legacy-disposable")).toBe(false);
      expect(reconciled.panes[0].thread_id).not.toBe("legacy-thread");
      threads.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("follows a live terminal across pane and workspace locator changes", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
    const first = threads.reconcile(snapshot());
    const moved = snapshot("w2:p9");
    moved.panes[0].terminal_id = "term-w1:p1";
    moved.agents![0].terminal_id = "term-w1:p1";
    moved.workspaces = [{ workspace_id: "w2", label: "Moved", number: 2, tab_count: 1, pane_count: 1, focused: true }];
    moved.tabs = [{ tab_id: "w2:t1", workspace_id: "w2", label: "Main", number: 1, pane_count: 1, focused: true }];
    moved.panes[0].workspace_id = "w2";
    moved.panes[0].tab_id = "w2:t1";
    moved.agents![0].workspace_id = "w2";
    moved.agents![0].tab_id = "w2:t1";

    const reconciled = threads.reconcile(moved);

    expect(reconciled.threads).toHaveLength(1);
    expect(reconciled.threads?.[0].thread_id).toBe(first.threads?.[0].thread_id);
    expect(reconciled.threads?.[0].current_run).toMatchObject({
      run_id: first.threads?.[0].current_run?.run_id,
      workspace_id: "w2",
      pane_id: "w2:p9",
    });
    threads.close();
  });

  it("keeps adopted identities across bridge restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-threads-"));
    const path = join(directory, "control.db");
    try {
      const firstManager = new ThreadManager({ path, createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
      const first = firstManager.reconcile(snapshot());
      firstManager.close();

      const secondManager = new ThreadManager({ path, createId: ids(), now: () => "2026-08-19T12:01:00.000Z" });
      const second = secondManager.reconcile(snapshot());
      expect(second.threads?.[0].thread_id).toBe(first.threads?.[0].thread_id);
      expect(second.threads?.[0].current_run?.run_id).toBe(first.threads?.[0].current_run?.run_id);
      secondManager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("repairs a legacy open Thread whose Run already ended", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-orphan-thread-"));
    const path = join(directory, "control.db");
    try {
      const first = new ThreadManager({ path, createId: ids(), now: () => "2026-08-20T11:00:00.000Z" });
      const adopted = first.reconcile(snapshot());
      const threadId = adopted.threads![0].thread_id;
      first.close();

      const database = new DatabaseSync(path);
      database.prepare("UPDATE runs SET ended_at = ? WHERE thread_id = ?")
        .run("2026-08-20T11:30:00.000Z", threadId);
      database.close();

      const restarted = new ThreadManager({ path, createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
      const repaired = restarted.reconcile(emptySnapshot());

      expect(repaired.threads?.find((thread) => thread.thread_id === threadId)).toMatchObject({
        lifecycle: "archived",
        archived_at: "2026-08-20T12:00:00.000Z",
      });
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backfills legacy Thread ownership from its recorded Run location", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-thread-project-"));
    const path = join(directory, "control.db");
    try {
      const first = new ThreadManager({ path, createId: ids(), now: () => "2026-08-20T11:00:00.000Z" });
      const observed = snapshot();
      observed.repositories = [repository()];
      const adopted = first.reconcile(observed);
      const threadId = adopted.threads![0].thread_id;
      first.close();

      const database = new DatabaseSync(path);
      database.prepare("UPDATE threads SET project_id = NULL, worktree_id = NULL WHERE thread_id = ?").run(threadId);
      database.close();

      const restarted = new ThreadManager({ path, createId: ids(), now: () => "2026-08-20T12:00:00.000Z" });
      const reconciled = restarted.reconcile(observed);
      const thread = reconciled.threads?.find((candidate) => candidate.thread_id === threadId);

      expect(thread).toMatchObject({
        project_id: reconciled.projects?.[0].project_id,
        worktree_id: reconciled.worktrees?.[0].worktree_id,
      });
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when persisted state contains broken references", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-corrupt-state-"));
    const path = join(directory, "control.db");
    try {
      const first = new ThreadManager({ path });
      first.close();
      const database = new DatabaseSync(path);
      database.exec("PRAGMA foreign_keys = OFF");
      database.prepare(`
        INSERT INTO runs (
          run_id, thread_id, workspace_id, workspace_label, tab_id, pane_id,
          terminal_id, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "broken-run",
        "missing-thread",
        "w1",
        "Control",
        "w1:t1",
        "w1:p1",
        "terminal-1",
        "2026-08-20T12:00:00.000Z",
        "2026-08-20T12:00:00.000Z",
      );
      database.close();

      expect(() => new ThreadManager({ path })).toThrow(/broken foreign-key references/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("archives the Thread and asks Herdr to retire only its active pane", async () => {
    const retirePane = vi.fn(async () => "retired" as const);
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane,
      createId: ids(),
      now: () => "2026-08-19T12:00:00.000Z",
    });
    const adopted = threads.reconcile(snapshot());

    const archived = await threads.archive(adopted.threads![0].thread_id);

    expect(archived.lifecycle).toBe("archived");
    expect(retirePane).toHaveBeenCalledExactlyOnceWith("w1:p1");
    threads.close();
  });

  it("keeps retained Herdr Runs archived without retrying retirement during reconciliation", async () => {
    const retirePane = vi.fn(async () => "retained" as const);
    const threads = new ThreadManager({ path: ":memory:", retirePane, createId: ids() });
    const adopted = threads.reconcile(snapshot());

    await threads.archive(adopted.threads![0].thread_id);
    const reconciled = threads.reconcile(snapshot());

    expect(reconciled.threads?.[0]).toMatchObject({
      lifecycle: "archived",
      current_run: { pane_id: "w1:p1" },
    });
    expect(reconciled.panes).toEqual([]);
    expect(retirePane).toHaveBeenCalledTimes(1);
    threads.close();
  });

  it("deletes an adopted agent with no resumable session and keeps its retained pane hidden", () => {
    const retirePane = vi.fn(async () => "retired" as const);
    const threads = new ThreadManager({ path: ":memory:", retirePane, createId: ids() });
    const adopted = threads.reconcile(snapshot("w1:p1", null));

    threads.deleteThread(adopted.threads![0].thread_id);
    const reconciled = threads.reconcile(snapshot("w1:p1", null));

    expect(reconciled.threads).toEqual([]);
    expect(reconciled.panes).toEqual([]);
    expect(retirePane).toHaveBeenCalledExactlyOnceWith("w1:p1");
    threads.close();
  });

  it("deletes a non-restorable Thread automatically when its Run disappears", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids() });
    threads.reconcile(snapshot("w1:p1", null));

    const reconciled = threads.reconcile(emptySnapshot());

    expect(reconciled.threads).toEqual([]);
    threads.close();
  });

  it("refuses to archive a Thread until it has a resumable session reference", async () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids() });
    const adopted = threads.reconcile(snapshot("w1:p1", null));

    await expect(threads.archive(adopted.threads![0].thread_id)).rejects.toThrow(/must be deleted/);
    expect(threads.list()).toHaveLength(1);
    threads.close();
  });

  it("keeps a Thread archived when runtime retirement fails", async () => {
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane: async () => { throw new Error("retirement failed"); },
      createId: ids(),
      now: () => "2026-08-19T12:00:00.000Z",
    });
    const adopted = threads.reconcile(snapshot());

    const archived = await threads.archive(adopted.threads![0].thread_id);

    expect(archived).toMatchObject({ lifecycle: "archived" });
    expect(threads.list()[0]).toMatchObject({ lifecycle: "archived" });
    threads.close();
  });

  it("restores an archived Thread through one provider-independent seam", async () => {
    const restoreThread = vi.fn(async () => undefined);
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane: async () => "retired",
      restoreThread,
      createId: ids(),
      now: () => "2026-08-19T12:00:00.000Z",
    });
    const adopted = threads.reconcile(snapshot());
    const threadId = adopted.threads![0].thread_id;
    await threads.archive(threadId);
    threads.reconcile(emptySnapshot());

    const requested = await threads.restore(threadId);
    const request = restoreThread.mock.calls[0]![0];
    const resumedPane = snapshot("w1:p2");
    resumedPane.panes[0].name = request.agentName;
    resumedPane.agents![0].name = request.agentName;
    const restored = threads.reconcile(resumedPane).threads![0];

    expect(requested).toMatchObject({ lifecycle: "archived", restoring: true });
    expect(restored.lifecycle).toBe("open");
    expect(restored.restoring).toBe(false);
    expect(restoreThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      threadId,
      agentName: expect.stringMatching(/^restored_/),
      agent: "codex",
      workspaceId: "w1",
      cwd: "/projects/control",
      session: expect.objectContaining({ value: "agent-session-1" }),
    }));
    threads.close();
  });

  it("keeps a Thread archived when its restore launch fails", async () => {
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane: async () => "retired",
      restoreThread: async () => { throw new Error("launch failed"); },
      createId: ids(),
      now: () => "2026-08-19T12:00:00.000Z",
    });
    const adopted = threads.reconcile(snapshot());
    const threadId = adopted.threads![0].thread_id;
    await threads.archive(threadId);
    threads.reconcile(emptySnapshot());

    await expect(threads.restore(threadId)).rejects.toThrow("launch failed");
    expect(threads.list()[0].lifecycle).toBe("archived");
    threads.close();
  });

  it("expires an unobserved restore claim so it can be retried after a bridge interruption", async () => {
    let observedAt = "2026-08-19T12:00:00.000Z";
    const restoreThread = vi.fn(async () => undefined);
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane: async () => "retired",
      restoreThread,
      createId: ids(),
      now: () => observedAt,
    });
    const adopted = threads.reconcile(snapshot());
    const threadId = adopted.threads![0].thread_id;
    await threads.archive(threadId);
    threads.reconcile(emptySnapshot());
    await threads.restore(threadId);

    observedAt = "2026-08-19T12:02:00.000Z";
    const recovered = threads.reconcile(emptySnapshot());

    expect(recovered.threads?.[0].restoring).toBe(false);
    await expect(threads.restore(threadId)).resolves.toMatchObject({ restoring: true });
    expect(restoreThread).toHaveBeenCalledTimes(2);
    threads.close();
  });

  it("does not create durable Threads for ordinary shell panes", () => {
    const shell = snapshot();
    delete shell.panes[0].agent;
    delete shell.panes[0].agent_status;
    delete shell.panes[0].agent_session;
    shell.agents = [];
    const threads = new ThreadManager({ path: ":memory:", createId: ids() });

    const reconciled = threads.reconcile(shell);

    expect(reconciled.threads).toEqual([]);
    expect(reconciled.panes[0].thread_id).toBeUndefined();
    threads.close();
  });

  it("hides a deleted shell while its Herdr pane is retained", () => {
    const shell = snapshot();
    delete shell.panes[0].agent;
    delete shell.panes[0].agent_status;
    delete shell.panes[0].agent_session;
    shell.agents = [];
    const retirePane = vi.fn(async () => "retained" as const);
    const threads = new ThreadManager({ path: ":memory:", retirePane, createId: ids() });
    threads.reconcile(shell);

    threads.deletePane("w1:p1");
    const reconciled = threads.reconcile(shell);

    expect(reconciled.panes).toEqual([]);
    expect(retirePane).toHaveBeenCalledExactlyOnceWith("w1:p1");
    threads.close();
  });

  it("persists deleted pane visibility across bridge restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-retirements-"));
    const path = join(directory, "control.db");
    const shell = snapshot();
    delete shell.panes[0].agent;
    delete shell.panes[0].agent_status;
    delete shell.panes[0].agent_session;
    shell.agents = [];
    try {
      const firstManager = new ThreadManager({ path, retirePane: async () => "retained", createId: ids() });
      firstManager.reconcile(shell);
      firstManager.deletePane("w1:p1");
      firstManager.close();

      const secondManager = new ThreadManager({ path, retirePane: async () => "retained", createId: ids() });
      expect(secondManager.reconcile(shell).panes).toEqual([]);
      secondManager.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retries retained panes only after terminal topology changes", async () => {
    const shell = snapshot();
    delete shell.panes[0].agent;
    delete shell.panes[0].agent_status;
    delete shell.panes[0].agent_session;
    shell.agents = [];
    const retirePane = vi.fn(async () => "retained" as const);
    const threads = new ThreadManager({ path: ":memory:", retirePane, createId: ids() });
    threads.reconcile(shell);
    threads.deletePane("w1:p1");
    await Promise.resolve();

    threads.reconcile(shell);
    expect(retirePane).toHaveBeenCalledTimes(1);

    const changed = structuredClone(shell);
    changed.panes.push({
      ...changed.panes[0],
      pane_id: "w1:p2",
      terminal_id: "term-w1:p2",
    });
    threads.reconcile(changed);
    await Promise.resolve();

    expect(retirePane).toHaveBeenCalledTimes(2);
    threads.close();
  });
});
