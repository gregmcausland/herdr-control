import type { ThreadCreationRequest, ThreadCreationResult } from "../shared/protocol.js";
import type { HerdrAdapter } from "./herdr.js";
import { generateThreadTitle, readNamingConfig } from "./local-naming.js";
import type { ThreadManager } from "./threads.js";

/** Names each new Thread independently of its checkout and coding agent. */
export class ThreadNamingService {
  private queue = Promise.resolve();
  private pending = 0;
  private controller = new AbortController();

  constructor(
    private readonly threads: ThreadManager,
    private readonly herdr: Pick<HerdrAdapter, "renameThread" | "snapshot">,
    private readonly configPath: string | undefined,
    private readonly refresh: () => void,
    private readonly generate = generateThreadTitle,
    private readonly warn: () => void = () => console.warn("Thread naming failed; the existing title was kept."),
  ) {}

  created(creation: ThreadCreationRequest, result: ThreadCreationResult): void {
    if (creation.title?.trim()) return;
    try { this.threads.registerThreadNaming(result.agent_name); }
    catch { this.warn(); }
  }

  prompted(threadId: string, text: string): void {
    if (this.controller.signal.aborted || this.pending >= 32) return;
    let claimed;
    try { claimed = this.threads.claimThreadNaming(threadId); }
    catch { this.warn(); return; }
    if (!claimed) return;
    const originalRun = claimed.current_run;
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (this.controller.signal.aborted) return;
      const config = await readNamingConfig(this.configPath);
      if (!config.enabled) return;
      const label = await this.generate(text, config, this.controller.signal);
      if (this.controller.signal.aborted || !this.threads.getThread(threadId)) return;
      this.threads.completeThreadNaming(threadId, label);
      this.refresh();
      const snapshot = await this.herdr.snapshot();
      if (this.controller.signal.aborted) return;
      this.threads.reconcile(snapshot);
      const current = this.threads.getThread(threadId)?.current_run;
      // A pane locator can be reused. Only rename the same surviving Run.
      if (current && current.run_id === originalRun?.run_id) {
        await this.herdr.renameThread(current.pane_id, current.tab_id, label);
        this.refresh();
      }
    }).catch(() => { if (!this.controller.signal.aborted) this.warn(); }).finally(() => { this.pending--; });
  }

  async close(): Promise<void> { this.controller.abort(); await this.queue; }
  async idle(): Promise<void> { await this.queue; }
}
