import { describe, expect, it } from "vitest";
import {
  agentIsReadyFromHerdrResponse,
  restoreLocationFromHerdrResponse,
  sessionSnapshotFromHerdrResponse,
  terminalMessageFromHerdrRecord,
  threadLocationFromHerdrResponse,
  worktreeInventoryFromHerdrResponse,
  worktreeOpenFromHerdrResponse,
} from "./herdr-protocol";

const pane = {
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  terminal_id: "terminal-1",
  cwd: "/projects/control",
  agent: "codex",
  name: "review_state_abc123",
  agent_status: "working",
  agent_session: {
    source: "codex-integration",
    agent: "codex",
    kind: "id",
    value: "session-1",
  },
  focused: true,
};

function snapshotResponse() {
  return {
    result: {
      snapshot: {
        version: "0.9.0",
        protocol: 22,
        focused_workspace_id: "w1",
        focused_tab_id: "w1:t1",
        focused_pane_id: "w1:p1",
        workspaces: [{
          workspace_id: "w1",
          label: "Control",
          number: 1,
          tab_count: 1,
          pane_count: 1,
          focused: true,
          worktree: {
            checkout_path: "/projects/control",
            is_linked_worktree: false,
            repo_key: "/projects/control/.git",
            repo_name: "control",
            repo_root: "/projects/control",
          },
        }],
        tabs: [{
          tab_id: "w1:t1",
          workspace_id: "w1",
          label: "Review state",
          number: 1,
          pane_count: 1,
          focused: true,
        }],
        panes: [pane],
        layouts: [{ workspace_id: "w1", tab_id: "w1:t1", focused_pane_id: "w1:p1", zoomed: false }],
        agents: [pane],
      },
    },
  };
}

describe("Herdr session adaptation", () => {
  it("validates a complete snapshot before returning Control runtime data", () => {
    const snapshot = sessionSnapshotFromHerdrResponse(snapshotResponse());

    expect(snapshot).toMatchObject({
      version: "0.9.0",
      protocol: 22,
      focused_pane_id: "w1:p1",
      workspaces: [{ workspace_id: "w1", worktree: { repo_key: "/projects/control/.git" } }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1" }],
      panes: [{ pane_id: "w1:p1", terminal_id: "terminal-1", agent_session: { value: "session-1" } }],
      agents: [{ pane_id: "w1:p1", agent: "codex", agent_status: "working" }],
    });
  });

  it("rejects a malformed nested pane instead of passing a partial snapshot to reconciliation", () => {
    const response = snapshotResponse();
    response.result.snapshot.panes = [{ ...pane, terminal_id: 42 }] as unknown as typeof response.result.snapshot.panes;

    expect(() => sessionSnapshotFromHerdrResponse(response)).toThrow(
      "Herdr returned an invalid session snapshot: panes[0].terminal_id must be non-empty text",
    );
  });

  it("rejects an incomplete agent session reference as one invalid snapshot", () => {
    const response = snapshotResponse();
    response.result.snapshot.panes = [{
      ...pane,
      agent_session: { ...pane.agent_session, value: undefined },
    }] as unknown as typeof response.result.snapshot.panes;

    expect(() => sessionSnapshotFromHerdrResponse(response)).toThrow(
      /panes\[0\]\.agent_session\.value/,
    );
  });

  it("preserves Herdr's response error message", () => {
    expect(() => sessionSnapshotFromHerdrResponse({
      error: { code: "snapshot_failed", message: "snapshot unavailable" },
    })).toThrow("snapshot unavailable");
  });
});

describe("Herdr terminal adaptation", () => {
  it("hides Herdr's frame vocabulary behind the Control protocol", () => {
    expect(terminalMessageFromHerdrRecord({
      type: "terminal.frame",
      seq: 4,
      width: 120,
      height: 32,
      full: true,
      bytes: "G1sySg==",
    })).toEqual({
      type: "frame",
      seq: 4,
      cols: 120,
      rows: 32,
      full: true,
      data: "G1sySg==",
    });
  });

  it.each([
    "terminal attach taken over",
    "terminal already has an attached client; retry with --takeover",
  ])("reports %s as ownership contention", (reason) => {
    expect(terminalMessageFromHerdrRecord({ type: "terminal.closed", reason })).toEqual({
      type: "occupied",
      message: reason,
    });
  });

  it("rejects malformed frame dimensions", () => {
    expect(() => terminalMessageFromHerdrRecord({
      type: "terminal.frame",
      seq: 1,
      width: "wide",
      height: 24,
      full: true,
      bytes: "",
    })).toThrow("Herdr returned an invalid terminal record: width must be an integer of at least 1");
  });
});

describe("Herdr Worktree inventory adaptation", () => {
  const response = {
    result: {
      source: {
        repo_key: "/projects/control/.git",
        repo_name: "control",
        repo_root: "/projects/control",
        source_checkout_path: "/projects/control",
        source_workspace_id: "w1",
      },
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
    },
  };

  it("returns Herdr's complete repository inventory", () => {
    expect(worktreeInventoryFromHerdrResponse(response)).toEqual({
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
    });
  });

  it("rejects the whole inventory when one Worktree is partial", () => {
    expect(worktreeInventoryFromHerdrResponse({
      ...response,
      result: { ...response.result, worktrees: [{ path: "/projects/control", label: "control" }] },
    })).toBeUndefined();
  });
});

describe("Herdr action response adaptation", () => {
  const locationResponse = {
    result: {
      workspace: { workspace_id: "w1" },
      tab: { tab_id: "w1:t2", workspace_id: "w1" },
      root_pane: { pane_id: "w1:p2" },
    },
  };

  it("adapts creation and Worktree-open locations", () => {
    expect(threadLocationFromHerdrResponse(locationResponse)).toEqual({
      workspaceId: "w1",
      tabId: "w1:t2",
      paneId: "w1:p2",
    });
    expect(worktreeOpenFromHerdrResponse({
      result: { ...locationResponse.result, already_open: true },
    })).toEqual({
      workspaceId: "w1",
      tabId: "w1:t2",
      paneId: "w1:p2",
      alreadyOpen: true,
    });
  });

  it("rejects an incomplete creation location", () => {
    expect(() => threadLocationFromHerdrResponse({
      result: { tab: { tab_id: "w1:t2", workspace_id: "w1" }, root_pane: {} },
    })).toThrow(/result\.root_pane\.pane_id/);
  });

  it("adapts restore locations without exposing Herdr response nesting", () => {
    expect(restoreLocationFromHerdrResponse(locationResponse, "tab")).toEqual({
      kind: "tab",
      id: "w1:t2",
      paneId: "w1:p2",
    });
  });

  it.each([
    [{ launch_pending: true }, false],
    [{ agent: null, launch_pending: true }, false],
    [{ agent: "codex", launch_pending: true }, false],
    [{ agent: "codex" }, false],
    [{ agent: "codex", interactive_ready: false }, false],
    [{ agent: "codex", interactive_ready: true }, true],
    [{ agent: "codex", interactive_ready: true, launch_pending: true }, false],
    [{ agent: "pi", interactive_ready: true }, false],
  ])("waits for the expected agent's explicit readiness: %j", (fields, ready) => {
    expect(agentIsReadyFromHerdrResponse({
      result: { agent: { pane_id: "w1:p2", name: "review_state_abc123", ...fields } },
    }, { paneId: "w1:p2", name: "review_state_abc123", kind: "codex" })).toBe(ready);
  });

  it("rejects malformed readiness fields and an unexpected named agent", () => {
    const expected = { paneId: "w1:p2", name: "review_state_abc123", kind: "codex" };
    expect(() => agentIsReadyFromHerdrResponse({
      result: { agent: { pane_id: "w1:p2", name: "different_agent", launch_pending: true } },
    }, expected)).toThrow(/unexpected agent/);
    expect(() => agentIsReadyFromHerdrResponse({
      result: { agent: { pane_id: "w1:p2", agent: 42 } },
    }, expected)).toThrow(/agent must be/);
    expect(() => agentIsReadyFromHerdrResponse({
      result: {
        agent: {
          pane_id: "w1:p2",
          name: "review_state_abc123",
          agent: "codex",
          interactive_ready: "yes",
        },
      },
    }, expected)).toThrow(/interactive_ready must be true or false/);
  });
});
