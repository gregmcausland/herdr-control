import { describe, expect, it } from "vitest";
import type { PaneInfo, WorkspaceInfo } from "../shared/protocol";
import { groupPanesByActivity } from "./activity-order";

function workspace(workspaceId: string): WorkspaceInfo {
  return {
    workspace_id: workspaceId,
    label: workspaceId,
    number: 1,
    tab_count: 1,
    pane_count: 1,
    focused: false,
  };
}

function pane(paneId: string, workspaceId: string, agentStatus?: string): PaneInfo {
  return {
    pane_id: paneId,
    tab_id: `${workspaceId}:t1`,
    workspace_id: workspaceId,
    terminal_id: paneId,
    agent_status: agentStatus,
    focused: false,
  };
}

describe("activity ordering", () => {
  it("raises workspaces and panes by their most important agent state", () => {
    const groups = groupPanesByActivity(
      [workspace("idle"), workspace("working"), workspace("blocked"), workspace("done")],
      [
        pane("idle-pane", "idle", "idle"),
        pane("working-idle", "working", "idle"),
        pane("working-active", "working", "working"),
        pane("blocked-working", "blocked", "working"),
        pane("blocked-attention", "blocked", "blocked"),
        pane("done-pane", "done", "done"),
      ],
    );

    expect(groups.map(({ workspace: item }) => item.workspace_id)).toEqual([
      "blocked",
      "working",
      "done",
      "idle",
    ]);
    expect(groups[0].panes.map((item) => item.pane_id)).toEqual([
      "blocked-attention",
      "blocked-working",
    ]);
    expect(groups[1].panes.map((item) => item.pane_id)).toEqual([
      "working-active",
      "working-idle",
    ]);
  });

  it("preserves source order for equally ranked items", () => {
    const groups = groupPanesByActivity(
      [workspace("first"), workspace("second")],
      [pane("first-a", "first"), pane("first-b", "first", "idle"), pane("second-a", "second")],
    );

    expect(groups.map(({ workspace: item }) => item.workspace_id)).toEqual(["first", "second"]);
    expect(groups[0].panes.map((item) => item.pane_id)).toEqual(["first-a", "first-b"]);
  });
});
