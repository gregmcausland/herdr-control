import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../shared/protocol";
import { ThreadManager } from "./threads";
import { ThreadLifecycleService } from "./thread-lifecycle";
import { WorktreeNamingService } from "./worktree-naming";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });

function fixture(agent = "codex") {
  const directory = mkdtempSync(join(tmpdir(), "worktree-naming-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const configPath = join(directory, "naming.json");
  writeFileSync(configPath, '{"enabled":true}');
  const path = join(directory, "state.db");
  let threads = new ThreadManager({ path });
  cleanup.push(() => threads.close());
  const pane = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "term1", focused: true,
    cwd: "/project/worktrees/random", agent, name: "created_agent", agent_status: "idle" };
  const snapshot: SessionSnapshot = { version: "0.8.0", protocol: 20,
    workspaces: [{ workspace_id: "w1", label: "random", number: 1, tab_count: 1, pane_count: 1, focused: true }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Agent", number: 1, pane_count: 1, focused: true }],
    panes: [pane], agents: [pane], repositories: [{ repo_key: "/project/.git", repo_name: "project", repo_root: "/project",
      source_checkout_path: "/project", worktrees: [{ path: pane.cwd, branch: "random", label: "project",
        is_bare: false, is_detached: false, is_linked_worktree: true, is_prunable: false, open_workspace_id: "w1" }] }] };
  const projected = threads.reconcile(snapshot);
  const threadId = projected.threads![0].thread_id;
  const worktreeId = projected.worktrees![0].worktree_id;
  const result = { agent_name: "created_agent", workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1" };
  const herdr = { snapshot: vi.fn(async () => snapshot), renameWorkspace: vi.fn(async () => undefined),
    createThread: vi.fn(async () => result), promptThread: vi.fn(async () => undefined) };
  return { threads, configPath, snapshot, herdr, threadId, worktreeId, result, projectId: projected.projects![0].project_id,
    reopen() { threads.close(); threads = new ThreadManager({ path }); return threads; } };
}

describe("worktree naming", () => {
  it.each(["codex", "pi"])("names a new %s checkout after acknowledgement, once across retries and restarts", async agent => {
    const f = fixture(agent);
    let finish!: (label: string) => void;
    const generate = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const naming = new WorktreeNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate);
    const lifecycle = new ThreadLifecycleService(f.threads, f.herdr, vi.fn(), naming);
    await lifecycle.create(f.projectId, { agent, location: { kind: "create_worktree" } });
    expect(generate).not.toHaveBeenCalled();
    await lifecycle.prompt(f.threadId, "Improve voice recording");
    expect(f.herdr.promptThread).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await lifecycle.prompt(f.threadId, "A later message");
    finish("Improve voice recording");
    await naming.idle();
    expect(f.herdr.renameWorkspace).toHaveBeenCalledExactlyOnceWith("w1", "Improve voice recording");
    expect(f.threads.getWorktree(f.worktreeId)?.purpose_label).toBe("Improve voice recording");
    await naming.close();
    const reopened = f.reopen();
    reopened.reconcile(f.snapshot);
    expect(reopened.getWorktree(f.worktreeId)?.purpose_label).toBe("Improve voice recording");
    const again = new WorktreeNamingService(reopened, f.herdr, f.configPath, vi.fn(), generate);
    again.prompted(f.threadId, "Do something else");
    await again.idle();
    expect(generate).toHaveBeenCalledOnce();
    await again.close();
  });

  it("skips existing checkouts, explicit labels, disabled inference, and failed prompt delivery", async () => {
    const f = fixture();
    const generate = vi.fn(async () => "Unused");
    const naming = new WorktreeNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate);
    naming.created({ agent: "codex", location: { kind: "project" } }, f.result);
    naming.prompted(f.threadId, "Existing work");
    naming.created({ agent: "codex", location: { kind: "create_worktree", label: "My label" } }, f.result);
    naming.prompted(f.threadId, "Explicit name");
    await naming.idle();
    expect(generate).not.toHaveBeenCalled();
    naming.created({ agent: "codex", location: { kind: "create_worktree" } }, f.result);
    f.herdr.promptThread.mockRejectedValueOnce(new Error("Not ready"));
    const lifecycle = new ThreadLifecycleService(f.threads, f.herdr, vi.fn(), naming);
    await expect(lifecycle.prompt(f.threadId, "Failure")).rejects.toThrow("Not ready");
    expect(generate).not.toHaveBeenCalled();
    writeFileSync(f.configPath, '{"enabled":false}');
    await lifecycle.prompt(f.threadId, "Now accepted");
    await naming.idle();
    expect(generate).not.toHaveBeenCalled();
    await naming.close();
  });

  it("keeps manual workspace renames made during inference", async () => {
    const f = fixture();
    const naming = new WorktreeNamingService(f.threads, f.herdr, f.configPath, vi.fn(), async () => {
      f.snapshot.workspaces[0].label = "My better name";
      return "Generated name";
    });
    naming.created({ agent: "codex", location: { kind: "create_worktree" } }, f.result);
    naming.prompted(f.threadId, "Task");
    await naming.idle();
    expect(f.herdr.renameWorkspace).not.toHaveBeenCalled();
    expect(f.threads.getWorktree(f.worktreeId)?.purpose_label).toBeUndefined();
    await naming.close();
  });

  it("does not retry a failed naming command or affect later messages", async () => {
    const f = fixture();
    const generate = vi.fn(async () => { throw new Error("Quota exceeded"); });
    const warn = vi.fn();
    const naming = new WorktreeNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate, warn);
    naming.created({ agent: "codex", location: { kind: "create_worktree" } }, f.result);
    naming.prompted(f.threadId, "Task");
    await naming.idle();
    naming.prompted(f.threadId, "Another task");
    await naming.idle();
    expect(generate).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(f.herdr.renameWorkspace).not.toHaveBeenCalled();
    await naming.close();
  });
});
