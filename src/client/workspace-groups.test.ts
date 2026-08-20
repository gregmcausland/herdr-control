import { describe, expect, it } from "vitest";
import type { PaneInfo, WorkspaceInfo } from "../shared/protocol";
import { groupPanesByWorkspace } from "./workspace-groups";

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

describe("workspace grouping", () => {
  it("preserves project and pane order regardless of agent state", () => {
    const groups = groupPanesByWorkspace(
      [workspace("idle"), workspace("working"), workspace("blocked")],
      [
        pane("idle-pane", "idle", "idle"),
        pane("working-idle", "working", "idle"),
        pane("working-active", "working", "working"),
        pane("blocked-working", "blocked", "working"),
        pane("blocked-attention", "blocked", "blocked"),
      ],
    );

    expect(groups.map(({ workspace: item }) => item.workspace_id)).toEqual([
      "idle",
      "working",
      "blocked",
    ]);
    expect(groups[1].panes.map((item) => item.pane_id)).toEqual([
      "working-idle",
      "working-active",
    ]);
    expect(groups[2].panes.map((item) => item.pane_id)).toEqual([
      "blocked-working",
      "blocked-attention",
    ]);
  });
});
