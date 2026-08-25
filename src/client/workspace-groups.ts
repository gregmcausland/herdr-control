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

  const projectGroups: ProjectPaneGroup[] = projects.map((project) => ({
    id: project.project_id,
    label: project.name,
    project,
    panes: panesByProject.get(project.project_id) ?? [],
  }));
  const groups = [
    ...projectGroups,
    ...workspaces.flatMap((workspace) => {
      const workspacePanes = unclassifiedByWorkspace.get(workspace.workspace_id);
      return workspacePanes?.length
        ? [{ id: `workspace:${workspace.workspace_id}`, label: workspace.label, panes: workspacePanes }]
        : [];
    }),
  ];
  return groups.sort(compareProjectRecency);
}

export function compareProjectRecency(first: ProjectPaneGroup, second: ProjectPaneGroup): number {
  const firstCurrentRun = latestCurrentRunAt(first.panes);
  const secondCurrentRun = latestCurrentRunAt(second.panes);
  if (firstCurrentRun !== undefined && secondCurrentRun === undefined) return -1;
  if (firstCurrentRun === undefined && secondCurrentRun !== undefined) return 1;
  if (firstCurrentRun && secondCurrentRun) {
    const recency = secondCurrentRun.localeCompare(firstCurrentRun);
    if (recency !== 0) return recency;
  }

  const firstRun = first.project?.last_run_at;
  const secondRun = second.project?.last_run_at;
  if (firstRun && secondRun) {
    const recency = secondRun.localeCompare(firstRun);
    if (recency !== 0) return recency;
  } else if (firstRun) {
    return -1;
  } else if (secondRun) {
    return 1;
  }

  if (first.project && !second.project) return -1;
  if (!first.project && second.project) return 1;
  return first.label.localeCompare(second.label, undefined, { sensitivity: "base" })
    || first.id.localeCompare(second.id);
}

function latestCurrentRunAt(panes: PaneInfo[]): string | undefined {
  const currentRuns = panes.filter((pane) => pane.run_id);
  if (currentRuns.length === 0) return undefined;
  return currentRuns.reduce<string | undefined>((latest, pane) => (
    pane.run_started_at && (!latest || pane.run_started_at > latest)
      ? pane.run_started_at
      : latest
  ), undefined) ?? "";
}
