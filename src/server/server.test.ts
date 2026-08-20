import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { SessionSnapshot, TerminalClientMessage, TerminalServerMessage } from "../shared/protocol";
import type { HerdrAdapter } from "./herdr";
import type { SessionStateFeed } from "./live-session";
import { createControlServer } from "./server";
import { ThreadManager } from "./threads";

const snapshot: SessionSnapshot = {
  version: "test",
  protocol: 19,
  workspaces: [],
  tabs: [],
  panes: [],
};

describe("terminal ownership", () => {
  it("accepts control input only after Herdr confirms attachment", async () => {
    let emit: ((message: TerminalServerMessage) => void) | undefined;
    const send = vi.fn<(message: TerminalClientMessage) => void>();
    const dispose = vi.fn();
    const herdr = {
      connectTerminal: (_options: unknown, next: (message: TerminalServerMessage) => void) => {
        emit = next;
        return { send, dispose };
      },
      focusPane: async () => undefined,
      snapshot: async () => snapshot,
    } as unknown as HerdrAdapter;
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot }),
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const server = createControlServer({
      host: "127.0.0.1",
      port: 0,
      herdrBinary: "herdr",
      herdrSocketPath: "/tmp/herdr-test.sock",
      statePath: ":memory:",
      allowedOrigins: new Set(),
    }, herdr, session, new ThreadManager({ path: ":memory:" }));

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?target=w1:p1&mode=control&cols=80&rows=24`);
    const messages: TerminalServerMessage[] = [];
    client.on("message", (data) => messages.push(JSON.parse(data.toString()) as TerminalServerMessage));

    try {
      await once(client, "open");
      client.send(JSON.stringify({ type: "key", key: "enter" }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(send).not.toHaveBeenCalled();

      emit?.({ type: "frame", seq: 1, cols: 80, rows: 24, full: true, data: "" });
      await vi.waitFor(() => expect(messages.map((message) => message.type)).toEqual(["ready", "frame"]));
      client.send(JSON.stringify({ type: "key", key: "enter" }));
      await vi.waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith({ type: "key", key: "enter" }));

      emit?.({ type: "occupied", message: "terminal attach taken over" });
      client.send(JSON.stringify({ type: "key", key: "esc" }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      client.close();
      await once(client, "close");
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("Thread creation", () => {
  it("resolves the durable Project and delegates one creation command to Herdr", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const projected = threads.reconcile({
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
    });
    const createThread = vi.fn(async () => ({
      agent_name: "review_state_abc123",
      workspace_id: "w1",
      tab_id: "w1:t2",
      pane_id: "w1:p2",
    }));
    const herdr = { createThread } as unknown as HerdrAdapter;
    const requestRefresh = vi.fn();
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot: projected }),
      subscribe: () => () => undefined,
      requestRefresh,
      close: () => undefined,
    };
    const server = createControlServer({
      host: "127.0.0.1",
      port: 0,
      herdrBinary: "herdr",
      herdrSocketPath: "/tmp/herdr-test.sock",
      statePath: ":memory:",
      allowedOrigins: new Set(),
    }, herdr, session, threads);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects/${projected.projects![0].project_id}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "codex",
          title: "Review state",
          prompt: "Review the state model.",
          skip_permissions: true,
          location: { kind: "project" },
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        thread: {
          agent_name: "review_state_abc123",
          workspace_id: "w1",
          tab_id: "w1:t2",
          pane_id: "w1:p2",
        },
      });
      expect(createThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        project: projected.projects![0],
        projectWorkspaceId: "w1",
        creation: expect.objectContaining({
          agent: "codex",
          skip_permissions: true,
          location: { kind: "project" },
        }),
      }));
      expect(requestRefresh).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("Thread deletion", () => {
  it("rechecks Herdr and preserves a Thread whose session reference just appeared", async () => {
    const withoutSession = agentSnapshot();
    const withSession = agentSnapshot("session-1");
    const threads = new ThreadManager({ path: ":memory:" });
    const projected = threads.reconcile(withoutSession);
    const herdr = { snapshot: async () => withSession } as unknown as HerdrAdapter;
    const requestRefresh = vi.fn();
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot: projected }),
      subscribe: () => () => undefined,
      requestRefresh,
      close: () => undefined,
    };
    const server = createControlServer({
      host: "127.0.0.1",
      port: 0,
      herdrBinary: "herdr",
      herdrSocketPath: "/tmp/herdr-test.sock",
      statePath: ":memory:",
      allowedOrigins: new Set(),
    }, herdr, session, threads);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/threads/${projected.threads![0].thread_id}`,
        { method: "DELETE" },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/must be archived/) });
      expect(threads.list()[0].agent_session?.value).toBe("session-1");
      expect(requestRefresh).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

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
