import type {
  SessionSnapshot,
  ThreadCreationRequest,
  ThreadCreationResult,
  ThreadInfo,
} from "../shared/protocol.js";
import type { HerdrAdapter } from "./herdr.js";
import { ThreadNotFoundError, type ThreadManager } from "./threads.js";
import type { ThreadNamingService } from "./thread-naming.js";

export class ProjectNotFoundError extends Error {}
export class WorktreeNotFoundError extends Error {}
export class PaneNotFoundError extends Error {}
export class PaneNotDeletableError extends Error {}
export class ThreadNotPromptableError extends Error {}

type ThreadLifecycleHerdr = Pick<HerdrAdapter, "createThread" | "promptThread" | "snapshot">;
type ThreadLifecycleStore = Pick<
  ThreadManager,
  | "archive"
  | "deletePane"
  | "deleteThread"
  | "getProject"
  | "getThread"
  | "getWorktree"
  | "listWorktrees"
  | "reconcile"
  | "restore"
  | "stop"
>;

/** Owns the policy that coordinates durable Threads with current Herdr state. */
export class ThreadLifecycleService {
  constructor(
    private readonly threads: ThreadLifecycleStore,
    private readonly herdr: ThreadLifecycleHerdr,
    private readonly requestRefresh: () => void = () => undefined,
    private readonly naming?: Pick<ThreadNamingService, "created" | "prompted">,
  ) {}

  async create(projectId: string, creation: ThreadCreationRequest): Promise<ThreadCreationResult> {
    const project = this.threads.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(`Project ${projectId} was not found`);

    const projectWorktrees = this.threads.listWorktrees().filter(
      (worktree) => worktree.project_id === project.project_id && !worktree.removed_at,
    );
    const selectedWorktree = creation.location.kind === "worktree"
      ? this.threads.getWorktree(creation.location.worktree_id)
      : undefined;
    if (
      creation.location.kind === "worktree"
      && (!selectedWorktree || selectedWorktree.project_id !== project.project_id || selectedWorktree.removed_at)
    ) {
      throw new WorktreeNotFoundError("The selected Worktree was not found in this Project");
    }

    const projectWorkspaceId = projectWorktrees.find(
      (worktree) => worktree.checkout_path === project.repo_root && worktree.runtime_workspace_id,
    )?.runtime_workspace_id ?? projectWorktrees.find(
      (worktree) => worktree.runtime_workspace_id,
    )?.runtime_workspace_id;
    const result = await this.herdr.createThread({
      project,
      projectWorkspaceId,
      worktree: selectedWorktree,
      creation,
    });
    this.naming?.created(creation, result);
    this.requestRefresh();
    return result;
  }

  async archive(threadId: string): Promise<ThreadInfo> {
    const thread = await this.threads.archive(threadId);
    this.requestRefresh();
    return thread;
  }

  async restore(threadId: string): Promise<ThreadInfo> {
    const thread = await this.threads.restore(threadId);
    this.requestRefresh();
    return thread;
  }

  async stop(threadId: string) {
    // Reconcile first so a reused pane locator cannot stop a different agent.
    this.threads.reconcile(await this.herdr.snapshot());
    const result = await this.threads.stop(threadId);
    this.requestRefresh();
    return result;
  }

  async prompt(threadId: string, text: string): Promise<void> {
    const thread = this.threads.getThread(threadId);
    if (!thread) throw new ThreadNotFoundError(`Thread ${threadId} was not found`);
    if (!thread.current_run) {
      throw new ThreadNotPromptableError("This Thread has no active agent");
    }
    // Check the current occupant before using a mutable pane locator. Herdr's
    // agent-aware prompt still owns validation and atomic text/Enter submission.
    const fresh = await this.herdr.snapshot();
    const pane = fresh.panes.find((pane) => pane.terminal_id === thread.current_run!.terminal_id);
    if (!pane || pane.agent !== thread.agent || (pane.agent_session && thread.agent_session
      && pane.agent_session.value !== thread.agent_session.value)) {
      throw new ThreadNotPromptableError("The agent changed or stopped. Refresh the Thread before sending.");
    }
    await this.herdr.promptThread(pane.pane_id, text);
    this.naming?.prompted(threadId, text);
    this.requestRefresh();
  }

  async deleteThread(threadId: string): Promise<void> {
    // A fresh snapshot prevents deleting a Thread whose first session reference just appeared.
    this.threads.reconcile(await this.herdr.snapshot());
    this.threads.deleteThread(threadId);
    this.requestRefresh();
  }

  async deletePane(paneId: string): Promise<void> {
    // Destructive decisions use current Herdr truth, never the retained stale projection.
    const snapshot = this.threads.reconcile(await this.herdr.snapshot());
    const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
    if (!pane) throw new PaneNotFoundError(`Pane ${paneId} was not found`);
    if (isAgentPane(snapshot, paneId, Boolean(pane.agent))) {
      throw new PaneNotDeletableError("Agent panes must be archived");
    }
    this.threads.deletePane(paneId);
    this.requestRefresh();
  }
}

function isAgentPane(snapshot: SessionSnapshot, paneId: string, paneHasAgent: boolean): boolean {
  return paneHasAgent || Boolean(snapshot.agents?.some((agent) => agent.pane_id === paneId));
}
