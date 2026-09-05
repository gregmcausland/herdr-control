import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { SessionSnapshot, TerminalClientMessage, TerminalServerMessage } from "../shared/protocol";
import type { HerdrAdapter } from "./herdr";
import type { SessionStateFeed } from "./live-session";
import { createControlServer } from "./server";
import { ThreadManager } from "./threads";
import { ControlHostStore } from "./control-hosts";

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
    let acknowledgeRelease!: () => void;
    const releaseAcknowledged = new Promise<void>((resolve) => (acknowledgeRelease = resolve));
    const release = vi.fn(() => releaseAcknowledged);
    const dispose = vi.fn();
    const herdr = {
      connectTerminal: (_options: unknown, next: (message: TerminalServerMessage) => void) => {
        emit = next;
        return { send, release, dispose };
      },
      focusPane: async () => undefined,
      snapshot: async () => snapshot,
    } as unknown as HerdrAdapter;
    const requestRefresh = vi.fn();
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot }),
      subscribe: () => () => undefined,
      requestRefresh,
      close: () => undefined,
    };
    const threads = new ThreadManager({ path: ":memory:" });
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
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/terminal?target=w1:p1&mode=control&cols=80&rows=24`);
    const messages: TerminalServerMessage[] = [];
    client.on("message", (data) => messages.push(JSON.parse(data.toString()) as TerminalServerMessage));

    try {
      await once(client, "open");
      client.send(JSON.stringify({ type: "key", key: "enter" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(send).not.toHaveBeenCalled();

      emit?.({ type: "frame", seq: 1, cols: 80, rows: 24, full: true, data: "" });
      await vi.waitFor(() => expect(messages.map((message) => message.type)).toEqual(["ready", "frame"]));
      client.send(JSON.stringify({ type: "key", key: "enter" }));
      await vi.waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith({ type: "key", key: "enter" }));

      client.send(JSON.stringify({ type: "release" }));
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
      expect(messages.map((message) => message.type)).toEqual(["ready", "frame"]);
      acknowledgeRelease();
      await vi.waitFor(() => expect(messages.map((message) => message.type)).toEqual(["ready", "frame", "released"]));

      emit?.({ type: "occupied", message: "terminal attach taken over" });
      client.send(JSON.stringify({ type: "key", key: "esc" }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(send.mock.calls).toEqual([[{ type: "key", key: "enter" }]]);
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
    }, herdr, session, threads, undefined, async () => ["codex"]);
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

      const unavailable = await fetch(
        `http://127.0.0.1:${port}/api/projects/${projected.projects![0].project_id}/threads`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: "pi", location: { kind: "project" } }),
        },
      );
      expect(unavailable.status).toBe(409);
      expect(await unavailable.json()).toEqual({ error: "pi is not available on this Control Host" });
      expect(createThread).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("Thread messages", () => {
  it("retains a prompt receipt and returns it on replay without sending twice", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const projected = threads.reconcile(agentSnapshot("session-1"));
    const promptThread = vi.fn(async () => undefined);
    const herdr = { promptThread, snapshot: async () => agentSnapshot("session-1") } as unknown as HerdrAdapter;
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
      const thread = projected.threads![0];
      const response = await fetch(`http://127.0.0.1:${port}/api/threads/${thread.thread_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "  Continue with the fix.\n", message_id: "receipt-test-1" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ acknowledged: true, message: { delivery: "acknowledged" } });
      expect(promptThread).toHaveBeenCalledExactlyOnceWith("w1:p1", "  Continue with the fix.\n");
      expect(requestRefresh).toHaveBeenCalledOnce();
      const replay = await fetch(`http://127.0.0.1:${port}/api/threads/${thread.thread_id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "  Continue with the fix.\n", message_id: "receipt-test-1" }),
      });
      expect(await replay.json()).toMatchObject({ acknowledged: true, message: { message_id: "receipt-test-1" } });
      const conversation = await fetch(`http://127.0.0.1:${port}/api/threads/${thread.thread_id}/conversation`);
      expect(await conversation.json()).toMatchObject({
        thread: { thread_id: thread.thread_id },
        messages: [{ message_id: "receipt-test-1", text: "  Continue with the fix.\n", delivery: "acknowledged" }],
        has_older: false,
      });
      expect(promptThread).toHaveBeenCalledTimes(1);
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

describe("Control Host management", () => {
  it("lists, adds, renames, and removes Home bridge configuration", async () => {
    let nextId = 0;
    const hosts = new ControlHostStore({
      path: ":memory:",
      legacyHosts: [{ label: "Existing", url: "existing.example" }],
      createId: () => `host-${++nextId}`,
    });
    const threads = new ThreadManager({ path: ":memory:" });
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot }),
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const herdr = { snapshot: async () => snapshot } as unknown as HerdrAdapter;
    const server = createControlServer({
      host: "127.0.0.1",
      port: 0,
      herdrBinary: "herdr",
      herdrSocketPath: "/tmp/herdr-test.sock",
      statePath: ":memory:",
      allowedOrigins: new Set(),
    }, herdr, session, threads, hosts);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const initial = await fetch(`${base}/api/control-hosts`);
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({
        hosts: [{ label: "Existing", url: "https://existing.example" }],
      });

      const created = await fetch(`${base}/api/control-hosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Second", url: "second.example" }),
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { host: { host_id: string } };

      const renamed = await fetch(`${base}/api/control-hosts/${createdBody.host.host_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Renamed", url: "https://second.example" }),
      });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ host: { label: "Renamed" } });

      const removed = await fetch(`${base}/api/control-hosts/${createdBody.host.host_id}`, {
        method: "DELETE",
      });
      expect(removed.status).toBe(204);
      expect((await (await fetch(`${base}/api/control-hosts`)).json() as { hosts: unknown[] }).hosts)
        .toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("Agent availability", () => {
  it("reports the Control-supported agents discovered on this bridge host", async () => {
    const threads = new ThreadManager({ path: ":memory:" });
    const session: SessionStateFeed = {
      current: () => ({ status: "live", revision: 1, snapshot }),
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const herdr = { snapshot: async () => snapshot } as unknown as HerdrAdapter;
    const server = createControlServer({
      host: "127.0.0.1",
      port: 0,
      herdrBinary: "herdr",
      herdrSocketPath: "/tmp/herdr-test.sock",
      statePath: ":memory:",
      allowedOrigins: new Set(),
    }, herdr, session, threads, undefined, async () => ["codex", "pi"]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agents`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ agents: ["codex", "pi"] });
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
