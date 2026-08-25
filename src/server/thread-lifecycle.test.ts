import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../shared/protocol";
import type { HerdrAdapter } from "./herdr";
import {
  PaneNotDeletableError,
  ProjectNotFoundError,
  ThreadLifecycleService,
  WorktreeNotFoundError,
} from "./thread-lifecycle";
import { ThreadManager, ThreadNotDeletableError } from "./threads";

describe("ThreadLifecycleService", () => {
  it("resolves durable placement before asking Herdr to create a Thread", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const projected = threads.reconcile(repositorySnapshot());
    const createThread = vi.fn(async () => ({
      agent_name: "review_abc123",
      workspace_id: "w1",
      tab_id: "w1:t2",
      pane_id: "w1:p2",
    }));
    const refresh = vi.fn();
    const lifecycle = new ThreadLifecycleService(
      threads,
      { createThread } as unknown as HerdrAdapter,
      refresh,
    );

    const result = await lifecycle.create(projected.projects![0].project_id, {
      agent: "codex",
      location: { kind: "project" },
    });

    expect(result.pane_id).toBe("w1:p2");
    expect(createThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      project: projected.projects![0],
      projectWorkspaceId: "w1",
    }));
    expect(refresh).toHaveBeenCalledOnce();
    threads.close();
  });

  it("rejects missing Projects and Worktrees without calling Herdr", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const projected = threads.reconcile(repositorySnapshot());
    const createThread = vi.fn();
    const lifecycle = new ThreadLifecycleService(
      threads,
      { createThread } as unknown as HerdrAdapter,
    );

    await expect(lifecycle.create("missing", {
      agent: "codex",
      location: { kind: "project" },
    })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(lifecycle.create(projected.projects![0].project_id, {
      agent: "codex",
      location: { kind: "worktree", worktree_id: "missing" },
    })).rejects.toBeInstanceOf(WorktreeNotFoundError);
    expect(createThread).not.toHaveBeenCalled();
    threads.close();
  });

  it("refreshes Herdr truth before destructive Thread and pane decisions", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const withoutSession = agentSnapshot();
    const withSession = agentSnapshot("session-1");
    const projected = threads.reconcile(withoutSession);
    const snapshot = vi.fn(async () => withSession);
    const refresh = vi.fn();
    const lifecycle = new ThreadLifecycleService(
      threads,
      { snapshot } as unknown as HerdrAdapter,
      refresh,
    );

    await expect(lifecycle.deleteThread(projected.threads![0].thread_id))
      .rejects.toBeInstanceOf(ThreadNotDeletableError);
    await expect(lifecycle.deletePane("w1:p1"))
      .rejects.toBeInstanceOf(PaneNotDeletableError);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    threads.close();
  });
});

function repositorySnapshot(): SessionSnapshot {
  return {
    version: "test",
    protocol: 19,
    workspaces: [{ workspace_id: "w1", label: "Control", number: 1, tab_count: 0, pane_count: 0, focused: true }],
    tabs: [],
    panes: [],
    repositories: [{
      repo_key: "/projects/control/.git",
      repo_name: "control",
      repo_root: "/projects/control",
      source_checkout_path: "/projects/control",
      source_workspace_id: "w1",
      worktrees: [{
        path: "/projects/control",
        label: "control",
        branch: "main",
        is_bare: false,
        is_detached: false,
        is_linked_worktree: false,
        is_prunable: false,
        open_workspace_id: "w1",
      }],
    }],
  };
}

function agentSnapshot(sessionValue?: string): SessionSnapshot {
  const pane = {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "terminal-1",
    cwd: "/projects/control",
    agent: "codex",
    agent_status: "idle",
    agent_session: sessionValue ? {
      source: "codex-integration",
      agent: "codex",
      kind: "id",
      value: sessionValue,
    } : undefined,
    focused: true,
  };
  return {
    version: "test",
    protocol: 19,
    workspaces: [{ workspace_id: "w1", label: "Control", number: 1, tab_count: 1, pane_count: 1, focused: true }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Thread", number: 1, pane_count: 1, focused: true }],
    panes: [pane],
    agents: [pane],
  };
}
