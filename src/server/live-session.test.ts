import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../shared/protocol";
import {
  LiveSession,
  type SessionStateConnection,
  type SessionStateSource,
} from "./live-session";

const snapshot: SessionSnapshot = {
  version: "0.8.0",
  protocol: 19,
  focused_workspace_id: "w1",
  focused_tab_id: "w1:t1",
  focused_pane_id: "w1:p1",
  workspaces: [{ workspace_id: "w1", label: "Project", number: 1, tab_count: 1, pane_count: 1, focused: true }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Main", number: 1, pane_count: 1, focused: true }],
  panes: [{
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term_1",
    agent: "codex",
    agent_status: "idle",
    focused: true,
  }],
};

class FakeConnection implements SessionStateConnection {
  private listener?: () => void;
  private resolveClosed!: (error: Error | undefined) => void;
  private readonly refreshes: Array<Promise<SessionSnapshot>> = [];
  readonly closed = new Promise<Error | undefined>((resolve) => (this.resolveClosed = resolve));
  refreshCalls = 0;

  constructor(readonly snapshot: SessionSnapshot) {}

  subscribe(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  queueRefresh(next: SessionSnapshot | Promise<SessionSnapshot>): void {
    this.refreshes.push(Promise.resolve(next));
  }

  refresh(): Promise<SessionSnapshot> {
    this.refreshCalls += 1;
    const next = this.refreshes.shift();
    if (!next) return Promise.reject(new Error("No fake snapshot queued"));
    return next;
  }

  emitChange(): void {
    this.listener?.();
  }

  disconnect(error?: Error): void {
    this.resolveClosed(error);
  }

  close(error?: Error): void {
    this.disconnect(error);
  }
}

class FakeSource implements SessionStateSource {
  private readonly waiting: Array<(connection: SessionStateConnection) => void> = [];

  connect(): Promise<SessionStateConnection> {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  open(nextSnapshot: SessionSnapshot): FakeConnection {
    const connection = new FakeConnection(nextSnapshot);
    const resolve = this.waiting.shift();
    if (!resolve) throw new Error("LiveSession has not requested a connection");
    resolve(connection);
    return connection;
  }
}

describe("LiveSession", () => {
  it("coalesces socket changes into one authoritative snapshot refresh", async () => {
    const source = new FakeSource();
    const session = new LiveSession(source, 1, 1);
    const connection = source.open(snapshot);
    await vi.waitFor(() => expect(session.current().status).toBe("live"));

    const updated = {
      ...snapshot,
      panes: [{ ...snapshot.panes[0], agent_status: "working" }],
    };
    connection.queueRefresh(updated);
    connection.emitChange();
    connection.emitChange();
    connection.emitChange();

    await vi.waitFor(() => expect(session.current().snapshot).toBe(updated));
    expect(connection.refreshCalls).toBe(1);
    session.close();
  });

  it("refreshes again when state changes during an in-flight snapshot", async () => {
    const source = new FakeSource();
    const session = new LiveSession(source, 1, 1);
    const connection = source.open(snapshot);
    await vi.waitFor(() => expect(session.current().status).toBe("live"));

    let finishFirst!: (value: SessionSnapshot) => void;
    connection.queueRefresh(new Promise((resolve) => (finishFirst = resolve)));
    const finalSnapshot = { ...snapshot, panes: [] };
    connection.queueRefresh(finalSnapshot);
    connection.emitChange();
    await vi.waitFor(() => expect(connection.refreshCalls).toBe(1));

    connection.emitChange();
    finishFirst({ ...snapshot, panes: [{ ...snapshot.panes[0], agent_status: "done" }] });

    await vi.waitFor(() => expect(session.current().snapshot).toBe(finalSnapshot));
    expect(connection.refreshCalls).toBe(2);
    session.close();
  });

  it("marks retained state stale and replaces it after reconnecting", async () => {
    const source = new FakeSource();
    const session = new LiveSession(source, 1, 1);
    const first = source.open(snapshot);
    await vi.waitFor(() => expect(session.current().status).toBe("live"));

    first.disconnect(new Error("socket unavailable"));
    await vi.waitFor(() => expect(session.current().status).toBe("stale"));
    expect(session.current().snapshot).toBe(snapshot);
    expect(session.current().message).toBe("socket unavailable");

    const reconnected = {
      ...snapshot,
      panes: [{ ...snapshot.panes[0], agent_status: "done" }],
    };
    await vi.waitFor(() => expect(() => source.open(reconnected)).not.toThrow());
    await vi.waitFor(() => expect(session.current().status).toBe("live"));
    expect(session.current().snapshot).toBe(reconnected);
    session.close();
  });
});
