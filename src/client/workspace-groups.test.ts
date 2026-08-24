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

  it("puts every current Run first, including non-repository workspace groups", () => {
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

    const running = pane("working-pane", "working", "working");
    running.project_id = "project-bravo";
    running.run_id = "run-bravo";
    running.run_started_at = "2026-08-24T11:00:00.000Z";
    const nonRepositoryRun = pane("done-pane", "xlean", "done");
    nonRepositoryRun.run_id = "run-xlean";
    nonRepositoryRun.run_started_at = "2026-08-24T14:00:00.000Z";
    const groups = groupPanesByProject(
      projects,
      [],
      [workspace("working"), workspace("xlean")],
      [running, nonRepositoryRun],
    );

    expect(groups.map(({ id }) => id)).toEqual([
      "workspace:xlean",
      "project-bravo",
      "project-latest",
      "project-recent",
      "project-alpha",
    ]);
    expect(projects[0].project_id).toBe("project-bravo");
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
