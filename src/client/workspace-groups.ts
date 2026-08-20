import type { PaneInfo, WorkspaceInfo } from "../shared/protocol";

export interface WorkspacePaneGroup {
  workspace: WorkspaceInfo;
  panes: PaneInfo[];
}

/** Groups panes by workspace while preserving the source order of both. */
export function groupPanesByWorkspace(
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
): WorkspacePaneGroup[] {
  const panesByWorkspace = new Map<string, PaneInfo[]>();
  for (const pane of panes) {
    const workspacePanes = panesByWorkspace.get(pane.workspace_id) ?? [];
    workspacePanes.push(pane);
    panesByWorkspace.set(pane.workspace_id, workspacePanes);
  }

  return workspaces.flatMap((workspace) => {
    const workspacePanes = panesByWorkspace.get(workspace.workspace_id);
    if (!workspacePanes?.length) return [];
    return [{ workspace, panes: workspacePanes }];
  });
}
