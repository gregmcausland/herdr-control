import { describe, expect, it } from "vitest";
import type { PaneInfo, ProjectInfo, WorkspaceInfo, WorktreeInfo } from "../shared/protocol";
import { groupPanesByProject } from "./workspace-groups";

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
  it("groups multiple worktrees under their durable project and preserves pane order", () => {
    const projects: ProjectInfo[] = [{
      project_id: "project-1",
      name: "Control",
      repo_key: "/projects/control/.git",
      repo_root: "/projects/control",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
    }];
    const worktrees: WorktreeInfo[] = ["main", "feature"].map((name) => ({
      worktree_id: `worktree-${name}`,
      project_id: "project-1",
      label: name,
      checkout_path: `/projects/${name}`,
      is_linked_worktree: name !== "main",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
    }));
    const main = pane("idle-pane", "idle", "idle");
    main.worktree_id = "worktree-main";
    const feature = pane("working-active", "working", "working");
    feature.project_id = "project-1";
    feature.worktree_id = "worktree-feature";
    const shell = pane("shell", "blocked");

    const groups = groupPanesByProject(
      projects,
      worktrees,
      [workspace("idle"), workspace("working"), workspace("blocked")],
      [main, feature, shell],
    );

    expect(groups.map(({ label }) => label)).toEqual(["Control", "blocked"]);
    expect(groups[0].panes.map((item) => item.pane_id)).toEqual(["idle-pane", "working-active"]);
    expect(groups[1].panes.map((item) => item.pane_id)).toEqual(["shell"]);
  });

  it("retains an empty durable Project so new work can be created in it", () => {
    const projects: ProjectInfo[] = [{
      project_id: "project-1",
      name: "Control",
      repo_key: "/projects/control/.git",
      repo_root: "/projects/control",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
    }];

    expect(groupPanesByProject(projects, [], [], [])).toEqual([{
      id: "project-1",
      label: "Control",
      project: projects[0],
      panes: [],
    }]);
  });
});
