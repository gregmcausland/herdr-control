import type { PaneInfo, WorkspaceInfo } from "../shared/protocol";

export interface WorkspacePaneGroup {
  workspace: WorkspaceInfo;
  panes: PaneInfo[];
}

const statusPriority: Record<string, number> = {
  blocked: 0,
  working: 1,
  done: 2,
};

function priorityOf(pane: PaneInfo): number {
  return statusPriority[pane.agent_status ?? "unknown"] ?? 3;
}

function stableSortByPriority<T>(items: T[], priorityOfItem: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, priority: priorityOfItem(item) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ item }) => item);
}

/** Groups panes by workspace, bringing work that needs attention to the top. */
export function groupPanesByActivity(
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
): WorkspacePaneGroup[] {
  const panesByWorkspace = new Map<string, PaneInfo[]>();
  for (const pane of panes) {
    const workspacePanes = panesByWorkspace.get(pane.workspace_id) ?? [];
    workspacePanes.push(pane);
    panesByWorkspace.set(pane.workspace_id, workspacePanes);
  }

  const groups = workspaces.flatMap((workspace) => {
    const workspacePanes = panesByWorkspace.get(workspace.workspace_id);
    if (!workspacePanes?.length) return [];
    return [{ workspace, panes: stableSortByPriority(workspacePanes, priorityOf) }];
  });

  return stableSortByPriority(groups, (group) => priorityOf(group.panes[0]));
}
