import type { SessionFeedState, SessionSnapshot } from "../shared/protocol.js";

const REFRESH_DELAY_MS = 50;

export interface SessionStateConnection {
  snapshot: SessionSnapshot;
  refresh(): Promise<SessionSnapshot>;
  subscribe(listener: () => void): () => void;
  closed: Promise<Error | undefined>;
  close(error?: Error): void;
}

export interface SessionStateSource {
  connect(): Promise<SessionStateConnection>;
}

export interface SessionStateFeed {
  current(): SessionFeedState;
  subscribe(listener: (state: SessionFeedState) => void): () => void;
  requestRefresh?(): void;
  close(): void;
}

interface RefreshCycle {
  queued: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** Keeps one authoritative session snapshot live across socket changes and reconnects. */
export class LiveSession implements SessionStateFeed {
  private state: SessionFeedState = { status: "connecting", revision: 0 };
  private readonly listeners = new Set<(state: SessionFeedState) => void>();
  private connection?: SessionStateConnection;
  private refreshCycle?: RefreshCycle;
  private stopped = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private resolveRetry?: () => void;

  constructor(
    private readonly source: SessionStateSource,
    private readonly retryDelayMs = 1_000,
    private readonly refreshDelayMs = REFRESH_DELAY_MS,
    private readonly projectSnapshot: (snapshot: SessionSnapshot) => SessionSnapshot = (snapshot) => snapshot,
  ) {
    void this.run();
  }

  current(): SessionFeedState {
    return this.state;
  }

  subscribe(listener: (state: SessionFeedState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  requestRefresh(): void {
    if (this.connection && this.refreshCycle) this.queueRefresh(this.connection, this.refreshCycle);
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearRefreshCycle();
    this.connection?.close();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.resolveRetry?.();
      this.resolveRetry = undefined;
    }
    this.listeners.clear();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const connection = await this.source.connect();
        if (this.stopped) {
          connection.close();
          return;
        }

        const cycle: RefreshCycle = { queued: false, running: false };
        this.connection = connection;
        this.refreshCycle = cycle;
        const unsubscribe = connection.subscribe(() => this.queueRefresh(connection, cycle));
        // The socket source queues events that race its bootstrap snapshot.
        // Do not reconcile that known-stale snapshot before the queued refresh.
        if (!cycle.queued) {
          this.publish({ status: "live", snapshot: this.projectSnapshot(connection.snapshot) });
        }
        const error = await connection.closed;
        unsubscribe();
        if (this.connection === connection) {
          this.clearRefreshCycle();
          this.connection = undefined;
        }
        if (this.stopped) return;

        this.publish({
          status: "stale",
          snapshot: this.state.snapshot,
          message: error?.message ?? "Herdr event subscription closed",
        });
      } catch (error) {
        if (this.stopped) return;
        this.publish({
          status: "stale",
          snapshot: this.state.snapshot,
          message: error instanceof Error ? error.message : "Unable to connect to Herdr",
        });
      }

      await this.waitBeforeRetry();
    }
  }

  private queueRefresh(connection: SessionStateConnection, cycle: RefreshCycle): void {
    if (this.stopped || this.connection !== connection || this.refreshCycle !== cycle) return;
    cycle.queued = true;
    if (cycle.running || cycle.timer) return;
    cycle.timer = setTimeout(() => {
      cycle.timer = undefined;
      void this.refresh(connection, cycle);
    }, this.refreshDelayMs);
    cycle.timer.unref?.();
  }

  private async refresh(connection: SessionStateConnection, cycle: RefreshCycle): Promise<void> {
    if (cycle.running) return;
    cycle.running = true;
    try {
      // An event arriving during a snapshot queues one more refresh, closing the
      // only race between snapshot capture and the event notification.
      while (
        cycle.queued
        && !this.stopped
        && this.connection === connection
        && this.refreshCycle === cycle
      ) {
        cycle.queued = false;
        let snapshot: SessionSnapshot;
        try {
          snapshot = await connection.refresh();
        } catch (error) {
          connection.close(error instanceof Error ? error : new Error("Unable to refresh Herdr state"));
          return;
        }
        if (this.stopped || this.connection !== connection || this.refreshCycle !== cycle) return;
        // An event during the read proves this snapshot may be stale. The loop
        // already has another refresh queued, so discard it before projection.
        if (cycle.queued) continue;
        try {
          this.publish({ status: "live", snapshot: this.projectSnapshot(snapshot) });
        } catch (error) {
          connection.close(error instanceof Error ? error : new Error("Unable to reconcile Thread state"));
          return;
        }
      }
    } finally {
      cycle.running = false;
    }
  }

  private clearRefreshCycle(): void {
    const cycle = this.refreshCycle;
    this.refreshCycle = undefined;
    if (cycle?.timer) clearTimeout(cycle.timer);
  }

  private publish(next: Omit<SessionFeedState, "revision">): void {
    this.state = { ...next, revision: this.state.revision + 1 };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // One browser connection must not break the shared state feed.
      }
    }
  }

  private waitBeforeRetry(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveRetry = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.resolveRetry = undefined;
        resolve();
      }, this.retryDelayMs);
      this.retryTimer.unref?.();
    });
  }
}
