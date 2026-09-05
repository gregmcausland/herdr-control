import type { PaneInfo, ProjectInfo, WorkspaceInfo, WorktreeInfo } from "../shared/protocol";

export interface ProjectPaneGroup {
  id: string;
  label: string;
  project?: ProjectInfo;
  panes: PaneInfo[];
}

/** Groups known panes by durable Project, with workspace fallbacks for shells. */
export function groupPanesByProject(
  projects: ProjectInfo[],
  worktrees: WorktreeInfo[],
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
): ProjectPaneGroup[] {
  const projectByWorktree = new Map(worktrees.map((worktree) => [worktree.worktree_id, worktree.project_id]));
  const panesByProject = new Map<string, PaneInfo[]>();
  const unclassifiedByWorkspace = new Map<string, PaneInfo[]>();
  for (const pane of panes) {
    const projectId = pane.project_id ?? (pane.worktree_id ? projectByWorktree.get(pane.worktree_id) : undefined);
    const target = projectId ? panesByProject : unclassifiedByWorkspace;
    const key = projectId ?? pane.workspace_id;
    const groupedPanes = target.get(key) ?? [];
    groupedPanes.push(pane);
    target.set(key, groupedPanes);
  }

  const projectGroups: ProjectPaneGroup[] = projects.flatMap((project) => {
    const projectPanes = panesByProject.get(project.project_id);
    return projectPanes?.length
      ? [{ id: project.project_id, label: project.name, project, panes: projectPanes }]
      : [];
  });
  const groups = [
    ...projectGroups,
    ...workspaces.flatMap((workspace) => {
      const workspacePanes = unclassifiedByWorkspace.get(workspace.workspace_id);
      return workspacePanes?.length
        ? [{ id: `workspace:${workspace.workspace_id}`, label: workspace.label, panes: workspacePanes }]
        : [];
    }),
  ];
  return groups.sort(compareProjectActivity);
}

/** Working Projects come first. Peers use fixed identity fields so live updates cannot reshuffle them. */
export function compareProjectActivity(first: ProjectPaneGroup, second: ProjectPaneGroup): number {
  const activity = Number(hasWorkingPane(second)) - Number(hasWorkingPane(first));
  if (activity !== 0) return activity;
  return first.label.localeCompare(second.label, undefined, { sensitivity: "base" })
    || first.id.localeCompare(second.id);
}

function hasWorkingPane(group: ProjectPaneGroup): boolean {
  return group.panes.some((pane) => pane.agent_status === "working");
}
