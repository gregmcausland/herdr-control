import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../shared/protocol";
import { ThreadManager } from "./threads";
import { ThreadLifecycleService } from "./thread-lifecycle";
import { ThreadNamingService } from "./thread-naming";

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
        is_bare: false, is_detached: false, is_linked_worktree: false, is_prunable: false, open_workspace_id: "w1" }] }] };
  const projected = threads.reconcile(snapshot);
  const threadId = projected.threads![0].thread_id;
  const worktreeId = projected.worktrees![0].worktree_id;
  const result = { agent_name: "created_agent", workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1" };
  const herdr = { snapshot: vi.fn(async () => snapshot), renameThread: vi.fn(async () => undefined),
    createThread: vi.fn(async () => result), promptThread: vi.fn(async () => undefined) };
  return { threads, configPath, snapshot, herdr, threadId, worktreeId, result, projectId: projected.projects![0].project_id,
    reopen() { threads.close(); threads = new ThreadManager({ path }); return threads; } };
}

describe("thread naming", () => {
  it.each(["codex", "pi"])("names a new %s thread in the project checkout after acknowledgement, once across retries and restarts", async agent => {
    const f = fixture(agent);
    let finish!: (label: string) => void;
    const generate = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const naming = new ThreadNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate);
    const lifecycle = new ThreadLifecycleService(f.threads, f.herdr, vi.fn(), naming);
    await lifecycle.create(f.projectId, { agent, location: { kind: "project" } });
    expect(generate).not.toHaveBeenCalled();
    await lifecycle.prompt(f.threadId, "Improve voice recording");
    expect(f.herdr.promptThread).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await lifecycle.prompt(f.threadId, "A later message");
    finish("Improve voice recording");
    await naming.idle();
    expect(f.herdr.renameThread).toHaveBeenCalledExactlyOnceWith("w1:p1", "w1:t1", "Improve voice recording");
    expect(f.threads.getThread(f.threadId)?.title).toBe("Improve voice recording");
    await naming.close();
    const reopened = f.reopen();
    reopened.reconcile(f.snapshot);
    expect(reopened.getThread(f.threadId)?.title).toBe("Improve voice recording");
    const again = new ThreadNamingService(reopened, f.herdr, f.configPath, vi.fn(), generate);
    again.prompted(f.threadId, "Do something else");
    await again.idle();
    expect(generate).toHaveBeenCalledOnce();
    await again.close();
  });

  it("respects an explicit thread title, disabled inference, and failed prompt delivery", async () => {
    const f = fixture();
    const generate = vi.fn(async () => "Unused");
    const naming = new ThreadNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate);
    naming.created({ agent: "codex", title: "My title", location: { kind: "project" } }, f.result);
    naming.prompted(f.threadId, "Explicit name");
    await naming.idle();
    expect(generate).not.toHaveBeenCalled();
    naming.created({ agent: "codex", location: { kind: "project" } }, f.result);
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

  it("gives two threads in the same worktree independent titles", async () => {
    const f = fixture();
    const secondPane = { ...f.snapshot.panes[0], pane_id: "w1:p2", tab_id: "w1:t2", terminal_id: "term2", name: "second_agent" };
    f.snapshot.panes.push(secondPane);
    f.snapshot.agents!.push(secondPane);
    f.snapshot.tabs.push({ ...f.snapshot.tabs[0], tab_id: "w1:t2" });
    const second = f.threads.reconcile(f.snapshot).threads!.find(thread => thread.agent_name === "second_agent")!;
    const generate = vi.fn(async (text: string) => text);
    const naming = new ThreadNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate);
    naming.created({ agent: "codex", location: { kind: "project" } }, f.result);
    naming.created({ agent: "pi", location: { kind: "worktree", worktree_id: f.worktreeId } }, { ...f.result, agent_name: "second_agent" });
    naming.prompted(f.threadId, "Improve voice input");
    naming.prompted(second.thread_id, "Fix checkout selection");
    await naming.idle();
    expect(f.threads.getThread(f.threadId)?.title).toBe("Improve voice input");
    expect(f.threads.getThread(second.thread_id)?.title).toBe("Fix checkout selection");
    expect(f.threads.getWorktree(f.worktreeId)?.label).toBe("project");
    expect(f.snapshot.workspaces[0].label).toBe("random");
    expect(generate).toHaveBeenCalledTimes(2);
    await naming.close();
  });

  it("retains the title but does not rename a replacement Run at the same pane locator", async () => {
    const f = fixture();
    const naming = new ThreadNamingService(f.threads, f.herdr, f.configPath, vi.fn(), async () => {
      f.snapshot.panes[0].terminal_id = "replacement-terminal";
      f.snapshot.panes[0].name = "replacement-agent";
      return "Original thread purpose";
    });
    naming.created({ agent: "codex", location: { kind: "project" } }, f.result);
    naming.prompted(f.threadId, "Task");
    await naming.idle();
    expect(f.herdr.renameThread).not.toHaveBeenCalled();
    expect(f.threads.getThread(f.threadId)?.title).toBe("Original thread purpose");
    await naming.close();
  });

  it("does not retry a failed naming command or affect later messages", async () => {
    const f = fixture();
    const generate = vi.fn(async () => { throw new Error("Quota exceeded"); });
    const warn = vi.fn();
    const naming = new ThreadNamingService(f.threads, f.herdr, f.configPath, vi.fn(), generate, warn);
    naming.created({ agent: "codex", location: { kind: "project" } }, f.result);
    naming.prompted(f.threadId, "Task");
    await naming.idle();
    naming.prompted(f.threadId, "Another task");
    await naming.idle();
    expect(generate).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(f.herdr.renameThread).not.toHaveBeenCalled();
    await naming.close();
  });
});
