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

    expect(groups.map(({ label }) => label)).toEqual(["blocked", "Control"]);
    expect(groups[1].panes.map((item) => item.pane_id)).toEqual(["idle-pane", "working-active"]);
    expect(groups[0].panes.map((item) => item.pane_id)).toEqual(["shell"]);
  });

  it("uses alphabetical Project order regardless of run activity", () => {
    const projects: ProjectInfo[] = [
      {
        project_id: "project-bravo",
        name: "Bravo",
        repo_key: "/projects/bravo/.git",
        repo_root: "/projects/bravo",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
      {
        project_id: "project-alpha",
        name: "Alpha",
        repo_key: "/projects/alpha/.git",
        repo_root: "/projects/alpha",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
      {
        project_id: "project-recent",
        name: "Recent",
        repo_key: "/projects/recent/.git",
        repo_root: "/projects/recent",
        last_run_at: "2026-08-24T12:00:00.000Z",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
      {
        project_id: "project-latest",
        name: "Latest",
        repo_key: "/projects/latest/.git",
        repo_root: "/projects/latest",
        last_run_at: "2026-08-24T13:00:00.000Z",
        created_at: "2026-08-20T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
      },
    ];

    const bravo = pane("working-bravo", "working-bravo", "working");
    bravo.project_id = "project-bravo";
    bravo.run_id = "run-bravo";
    bravo.run_started_at = "2026-08-24T11:00:00.000Z";
    const alpha = pane("working-alpha", "working-alpha", "working");
    alpha.project_id = "project-alpha";
    alpha.run_id = "run-alpha";
    alpha.run_started_at = "2026-08-24T10:00:00.000Z";
    const newerIdleRun = pane("idle-pane", "xlean", "idle");
    newerIdleRun.run_id = "run-xlean";
    newerIdleRun.run_started_at = "2026-08-24T14:00:00.000Z";
    const groups = groupPanesByProject(
      projects,
      [],
      [workspace("working-bravo"), workspace("working-alpha"), workspace("xlean")],
      [bravo, newerIdleRun, alpha],
    );

    expect(groups.map(({ id }) => id)).toEqual([
      "project-alpha",
      "project-bravo",
      "project-latest",
      "project-recent",
      "workspace:xlean",
    ]);
    expect(projects[0].project_id).toBe("project-bravo");
  });

  it("keeps durable Projects without active panes", () => {
    const projects: ProjectInfo[] = [{
      project_id: "project-1",
      name: "Control",
      repo_key: "/projects/control/.git",
      repo_root: "/projects/control",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-20T00:00:00.000Z",
    }];

    expect(groupPanesByProject(projects, [], [], [])).toEqual([{ id: "project-1", label: "Control", project: projects[0], panes: [] }]);
  });
});
