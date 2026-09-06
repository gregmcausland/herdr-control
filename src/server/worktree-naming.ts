import type { ThreadCreationRequest, ThreadCreationResult } from "../shared/protocol.js";
import type { HerdrAdapter } from "./herdr.js";
import { generateWorktreeLabel, readNamingConfig } from "./local-naming.js";
import type { ThreadManager } from "./threads.js";

/** Optional background naming. Herdr only receives the resulting imperative rename. */
export class WorktreeNamingService {
  private queue = Promise.resolve();
  private pending = 0;
  private controller = new AbortController();

  constructor(
    private readonly threads: ThreadManager,
    private readonly herdr: Pick<HerdrAdapter, "renameWorkspace" | "snapshot">,
    private readonly configPath: string | undefined,
    private readonly refresh: () => void,
    private readonly generate = generateWorktreeLabel,
    private readonly warn: () => void = () => console.warn("Worktree naming failed; the existing name was kept."),
  ) {}

  created(creation: ThreadCreationRequest, result: ThreadCreationResult): void {
    if (creation.location.kind !== "create_worktree" || creation.location.label?.trim()) return;
    try { this.threads.registerWorktreeNaming(result.agent_name); }
    catch { this.warn(); }
  }

  prompted(threadId: string, text: string): void {
    if (this.controller.signal.aborted || this.pending >= 32) return;
    let worktree;
    try { worktree = this.threads.claimWorktreeNaming(threadId); }
    catch { this.warn(); return; }
    if (!worktree) return;
    const claimed = worktree;
    const workspaceLabel = this.threads.getThread(threadId)?.current_run?.workspace_label;
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (this.controller.signal.aborted) return;
      const config = await readNamingConfig(this.configPath);
      if (!config.enabled) return;
      const label = await this.generate(text, config, this.controller.signal);
      if (this.controller.signal.aborted) return;
      const snapshot = await this.herdr.snapshot();
      if (this.controller.signal.aborted) return;
      this.threads.reconcile(snapshot);
      const current = this.threads.getWorktree(claimed.worktree_id);
      if (!current || current.removed_at) return;
      const workspace = snapshot.workspaces.find(item => item.workspace_id === current.runtime_workspace_id);
      if (workspace && workspace.workspace_id === claimed.runtime_workspace_id && workspace.label !== workspaceLabel) return;
      this.threads.completeWorktreeNaming(current.worktree_id, label);
      this.refresh();
      if (current.runtime_workspace_id && current.runtime_workspace_id === claimed.runtime_workspace_id
        && workspace) {
        await this.herdr.renameWorkspace(current.runtime_workspace_id, label);
        this.refresh();
      }
    }).catch(() => { if (!this.controller.signal.aborted) this.warn(); }).finally(() => { this.pending--; });
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.queue;
  }

  async idle(): Promise<void> { await this.queue; }
}
