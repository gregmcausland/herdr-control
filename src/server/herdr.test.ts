import { describe, expect, it } from "vitest";
import type { ProjectInfo, WorktreeInfo } from "../shared/protocol";
import {
  creationAgentName,
  creationTitle,
  HerdrAdapter,
  logicalKeyFromLegacyInput,
  permissionBypassArgsFor,
  resumeArgsFor,
  translateHerdrRecord,
} from "./herdr";
import { HerdrRequestError } from "./herdr-socket";

describe("Herdr terminal record translation", () => {
  it("hides Herdr's frame vocabulary behind the client interface", () => {
    expect(
      translateHerdrRecord({
        type: "terminal.frame",
        seq: 4,
        width: 120,
        height: 32,
        full: true,
        bytes: "G1sySg==",
      }),
    ).toEqual({
      type: "frame",
      seq: 4,
      cols: 120,
      rows: 32,
      full: true,
      data: "G1sySg==",
    });
  });

  it("reports a takeover as ownership contention", () => {
    expect(translateHerdrRecord({
      type: "terminal.closed",
      reason: "terminal attach taken over",
    })).toEqual({
      type: "occupied",
      message: "terminal attach taken over",
    });
  });

  it("turns controller contention into an actionable state", () => {
    expect(
      translateHerdrRecord({
        type: "terminal.closed",
        reason: "terminal already has an attached client; retry with --takeover",
      }),
    ).toEqual({
      type: "occupied",
      message: "terminal already has an attached client; retry with --takeover",
    });
  });
});

describe("legacy browser terminal input", () => {
  it("recovers navigation keys through Herdr's logical encoder", () => {
    expect(logicalKeyFromLegacyInput("\r")).toBe("enter");
    expect(logicalKeyFromLegacyInput("\x1b[B")).toBe("down");
    expect(logicalKeyFromLegacyInput("\x03")).toBe("ctrl+c");
  });

  it("leaves text input untouched", () => {
    expect(logicalKeyFromLegacyInput("hello")).toBeUndefined();
  });
});

describe("agent session restore commands", () => {
  it.each([
    ["codex", "id", "session-1", ["resume", "session-1"]],
    ["claude", "id", "session-2", ["--resume", "session-2"]],
    ["pi", "path", "/tmp/session.jsonl", ["--session", "/tmp/session.jsonl"]],
  ])("maps %s references to its native resume arguments", (agent, kind, value, expected) => {
    expect(resumeArgsFor(agent, { source: `herdr:${agent}`, agent, kind, value })).toEqual(expected);
  });
});

describe("agent launch permissions", () => {
  it.each([
    ["codex", ["--dangerously-bypass-approvals-and-sandbox"]],
    ["claude", ["--dangerously-skip-permissions"]],
    ["gemini", ["--approval-mode=yolo"]],
    ["pi", ["--approve"]],
    ["opencode", ["--auto"]],
  ])("maps the shared skip-permissions policy to %s", (agent, expected) => {
    expect(permissionBypassArgsFor(agent, true)).toEqual(expected);
  });

  it("passes no native arguments when the policy is disabled", () => {
    expect(permissionBypassArgsFor("codex", false)).toEqual([]);
  });
});

describe("archived pane retirement", () => {
  it("preserves panes protected by Herdr's worktree guard", async () => {
    const request = async () => {
      throw new HerdrRequestError("confirmation_required", "closing this pane would close a worktree group");
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await expect(herdr.retirePane("w1:p1")).resolves.toBe("retained");
  });

  it("does not hide unexpected pane retirement failures", async () => {
    const request = async () => { throw new Error("socket unavailable"); };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await expect(herdr.retirePane("w1:p1")).rejects.toThrow("socket unavailable");
  });
});

const project: ProjectInfo = {
  project_id: "project-1",
  name: "Control",
  repo_key: "/projects/control/.git",
  repo_root: "/projects/control",
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

function tabCreated(workspaceId = "w1", tabId = "w1:t2", paneId = "w1:p2") {
  return { result: { type: "tab_created", tab: { tab_id: tabId, workspace_id: workspaceId }, root_pane: { pane_id: paneId } } };
}

function agentStarted(params: Record<string, unknown>, launchPending = false) {
  return {
    result: {
      type: "agent_started",
      agent: {
        pane_id: params.pane_id,
        name: params.name,
        agent: params.kind ?? "codex",
        interactive_ready: !launchPending,
        launch_pending: launchPending,
      },
    },
  };
}

describe("new Thread creation", () => {
  it("derives concise Herdr labels and valid unique agent names", () => {
    const creation = { agent: "codex", prompt: "Build a clean creation interface\nwith details", location: { kind: "project" as const } };
    expect(creationTitle(creation)).toBe("Build a clean creation interface");
    expect(creationAgentName("123 Improve UI", "codex", "abc123")).toBe("codex_123_improve_ui_abc123");
  });

  it("creates a dedicated tab in an existing Project workspace before starting and prompting", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = async (_socket: string, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "tab.create") return tabCreated();
      if (method === "agent.start") return agentStarted(params);
      return { result: { type: method.replace(".", "_") } };
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    const result = await herdr.createThread({
      project,
      projectWorkspaceId: "w1",
      creation: {
        agent: "codex",
        title: "Review state model",
        prompt: "Review the current state model.",
        skip_permissions: true,
        location: { kind: "project" },
      },
    });

    expect(result).toMatchObject({ workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p2" });
    expect(calls.map((call) => call.method)).toEqual(["tab.create", "pane.rename", "agent.start", "agent.prompt"]);
    expect(calls[0].params).toMatchObject({
      workspace_id: "w1",
      cwd: "/projects/control",
      label: "Review state model",
      focus: false,
    });
    expect(calls[1].params).toEqual({ pane_id: "w1:p2", label: "Review state model" });
    expect(calls[2].params).toMatchObject({
      pane_id: "w1:p2",
      kind: "codex",
      name: result.agent_name,
      args: ["--dangerously-bypass-approvals-and-sandbox"],
    });
    expect(calls[3].params).toEqual({ target: "w1:p2", text: "Review the current state model." });
  });

  it("waits for Herdr detection before sending the initial message", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let startedName = "";
    const request = async (_socket: string, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "tab.create") return tabCreated();
      if (method === "agent.start") {
        startedName = String(params.name);
        return agentStarted(params, true);
      }
      if (method === "agent.get") {
        return {
          result: {
            type: "agent_info",
            agent: { pane_id: params.target, name: startedName, agent: "codex", agent_status: "idle" },
          },
        };
      }
      return { result: { type: method.replace(".", "_") } };
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await herdr.createThread({
      project,
      projectWorkspaceId: "w1",
      creation: {
        agent: "codex",
        prompt: "Begin only after the harness is ready.",
        location: { kind: "project" },
      },
    });

    expect(calls.map((call) => call.method)).toEqual([
      "tab.create",
      "pane.rename",
      "agent.start",
      "agent.get",
      "agent.prompt",
    ]);
    expect(calls.at(-1)?.params).toEqual({
      target: "w1:p2",
      text: "Begin only after the harness is ready.",
    });
  });

  it("opens an inactive Worktree and uses its new root tab", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = async (_socket: string, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "worktree.open") {
        return {
          result: {
            already_open: false,
            workspace: { workspace_id: "w2" },
            tab: { tab_id: "w2:t1", workspace_id: "w2" },
            root_pane: { pane_id: "w2:p1" },
          },
        };
      }
      if (method === "agent.start") return agentStarted(params);
      return { result: {} };
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);
    const worktree: WorktreeInfo = {
      worktree_id: "worktree-1",
      project_id: project.project_id,
      label: "feature",
      checkout_path: "/projects/control-feature",
      branch: "feature",
      is_linked_worktree: true,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };

    const result = await herdr.createThread({
      project,
      worktree,
      creation: { agent: "pi", title: "Feature work", location: { kind: "worktree", worktree_id: "worktree-1" } },
    });

    expect(result).toMatchObject({ workspace_id: "w2", tab_id: "w2:t1", pane_id: "w2:p1" });
    expect(calls.map((call) => call.method)).toEqual(["worktree.open", "tab.rename", "pane.rename", "agent.start"]);
    expect(calls[0].params).toMatchObject({ cwd: project.repo_root, path: worktree.checkout_path, focus: false });
  });

  it("creates a requested Worktree through Herdr before starting the agent", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = async (_socket: string, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "worktree.create") {
        return {
          result: {
            workspace: { workspace_id: "w3" },
            tab: { tab_id: "w3:t1", workspace_id: "w3" },
            root_pane: { pane_id: "w3:p1" },
          },
        };
      }
      if (method === "agent.start") return agentStarted(params);
      return { result: {} };
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await herdr.createThread({
      project,
      creation: {
        agent: "claude",
        title: "New branch",
        location: { kind: "create_worktree", branch: "feature/new-thread", base: "main" },
      },
    });

    expect(calls.map((call) => call.method)).toEqual(["worktree.create", "tab.rename", "pane.rename", "agent.start"]);
    expect(calls[0].params).toEqual({
      cwd: project.repo_root,
      branch: "feature/new-thread",
      base: "main",
      focus: false,
    });
  });

  it("still creates a fresh tab when a stale Worktree location is already open elsewhere", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let tabAttempt = 0;
    const request = async (_socket: string, method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "tab.create" && tabAttempt++ === 0) {
        throw new HerdrRequestError("workspace_not_found", "workspace closed");
      }
      if (method === "worktree.open") {
        return {
          result: {
            already_open: true,
            workspace: { workspace_id: "w2" },
            tab: { tab_id: "w2:t1", workspace_id: "w2" },
            root_pane: { pane_id: "w2:p1" },
          },
        };
      }
      if (method === "tab.create") return tabCreated("w2", "w2:t4", "w2:p4");
      if (method === "agent.start") return agentStarted(params);
      return { result: {} };
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);
    const worktree: WorktreeInfo = {
      worktree_id: "worktree-1",
      project_id: project.project_id,
      label: "feature",
      checkout_path: "/projects/control-feature",
      is_linked_worktree: true,
      runtime_workspace_id: "w-stale",
      created_at: project.created_at,
      updated_at: project.updated_at,
    };

    const result = await herdr.createThread({
      project,
      worktree,
      creation: { agent: "codex", title: "Fresh tab", location: { kind: "worktree", worktree_id: worktree.worktree_id } },
    });

    expect(result).toMatchObject({ workspace_id: "w2", tab_id: "w2:t4", pane_id: "w2:p4" });
    expect(calls.map((call) => call.method)).toEqual([
      "tab.create",
      "worktree.open",
      "tab.create",
      "pane.rename",
      "agent.start",
    ]);
  });
});
