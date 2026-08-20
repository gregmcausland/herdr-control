import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../shared/protocol";
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

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

describe("ThreadManager", () => {
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

  it("ends a vanished Run without archiving its Thread and reuses the provider session on resume", () => {
    const threads = new ThreadManager({ path: ":memory:", createId: ids(), now: () => "2026-08-19T12:00:00.000Z" });
    const adopted = threads.reconcile(snapshot());
    const threadId = adopted.threads![0].thread_id;
    const firstRunId = adopted.threads![0].current_run!.run_id;

    const stopped = threads.reconcile(emptySnapshot());
    expect(stopped.threads?.[0]).toMatchObject({ thread_id: threadId, lifecycle: "open" });
    expect(stopped.threads?.[0].current_run).toBeUndefined();

    const resumed = threads.reconcile(snapshot("w1:p2"));
    expect(resumed.threads?.[0].thread_id).toBe(threadId);
    expect(resumed.threads?.[0].current_run?.run_id).not.toBe(firstRunId);
    expect(resumed.panes[0].thread_id).toBe(threadId);
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

  it("archives an adopted agent even when it has no resumable session reference", async () => {
    const retirePane = vi.fn(async () => "retired" as const);
    const threads = new ThreadManager({ path: ":memory:", retirePane, createId: ids() });
    const adopted = threads.reconcile(snapshot("w1:p1", null));

    const archived = await threads.archive(adopted.threads![0].thread_id);

    expect(archived).toMatchObject({ lifecycle: "archived", agent_session: undefined });
    expect(retirePane).toHaveBeenCalledExactlyOnceWith("w1:p1");
    threads.close();
  });

  it("keeps a Thread archived when runtime retirement fails", async () => {
    const threads = new ThreadManager({
      path: ":memory:",
      retirePane: async () => { throw new Error("retirement failed"); },
      createId: ids(),
      now: () => "2026-08-19T12:00:00.000Z",
    });
    const adopted = threads.reconcile(snapshot("w1:p1", null));

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
