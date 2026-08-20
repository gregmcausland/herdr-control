export type TerminalMode = "control" | "observe";

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "key"; key: string }
  | { type: "view" }
  | { type: "resize"; cols: number; rows: number }
  | {
      type: "scroll";
      source: "wheel" | "page_key";
      direction: "up" | "down";
      lines: number;
      column?: number;
      row?: number;
    }
  | { type: "release" };

export type TerminalServerMessage =
  | { type: "ready"; mode: TerminalMode }
  | {
      type: "frame";
      seq: number;
      cols: number;
      rows: number;
      full: boolean;
      data: string;
    }
  | { type: "occupied"; message: string }
  | { type: "closed"; reason: string }
  | { type: "error"; message: string };

export interface WorkspaceInfo {
  workspace_id: string;
  label: string;
  number: number;
  tab_count: number;
  pane_count: number;
  focused: boolean;
  worktree?: {
    checkout_path: string;
    is_linked_worktree: boolean;
    repo_key: string;
    repo_name: string;
    repo_root: string;
  } | null;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  label: string;
  number: number;
  pane_count: number;
  focused: boolean;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  label?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  cwd?: string;
  foreground_cwd?: string;
  agent?: string;
  name?: string;
  agent_status?: string;
  agent_session?: AgentSessionReference;
  display_agent?: string;
  state_labels?: Record<string, string>;
  thread_id?: string;
  run_id?: string;
  project_id?: string;
  worktree_id?: string;
  working_started_at?: string;
  last_work_duration_ms?: number;
  focused: boolean;
}

export interface AgentSessionReference {
  source: string;
  agent: string;
  kind: string;
  value: string;
}

export type ThreadLifecycle = "open" | "archived";

export interface ThreadRunInfo {
  run_id: string;
  workspace_id: string;
  workspace_label: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  cwd?: string;
  agent_status?: string;
  started_at: string;
  working_started_at?: string;
  last_work_duration_ms?: number;
}

export interface ThreadInfo {
  thread_id: string;
  project_id?: string;
  worktree_id?: string;
  title: string;
  agent: string;
  agent_name?: string;
  agent_session?: AgentSessionReference;
  lifecycle: ThreadLifecycle;
  restoring?: boolean;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  current_run?: ThreadRunInfo;
}

export interface RepositoryWorktreeInfo {
  path: string;
  label: string;
  branch?: string;
  is_bare: boolean;
  is_detached: boolean;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  open_workspace_id?: string;
}

/** Herdr's authoritative repository/worktree inventory for one repository. */
export interface RepositoryWorktreeInventory {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  source_checkout_path: string;
  source_workspace_id?: string;
  worktrees: RepositoryWorktreeInfo[];
}

export interface ProjectInfo {
  project_id: string;
  name: string;
  repo_key: string;
  repo_root: string;
  created_at: string;
  updated_at: string;
}

export interface WorktreeInfo {
  worktree_id: string;
  project_id: string;
  label: string;
  checkout_path: string;
  branch?: string;
  is_linked_worktree: boolean;
  runtime_workspace_id?: string;
  removed_at?: string;
  created_at: string;
  updated_at: string;
}

export type ThreadCreationLocation =
  | { kind: "project" }
  | { kind: "worktree"; worktree_id: string }
  | { kind: "create_worktree"; branch?: string; base?: string; path?: string; label?: string }
  | { kind: "open_worktree"; path: string; label?: string };

export interface ThreadCreationRequest {
  agent: string;
  title?: string;
  prompt?: string;
  skip_permissions?: boolean;
  location: ThreadCreationLocation;
}

export interface ThreadCreationResult {
  agent_name: string;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
}

export interface PaneLayoutSnapshot {
  workspace_id: string;
  tab_id: string;
  focused_pane_id?: string;
  zoomed?: boolean;
  [key: string]: unknown;
}

export interface AgentInfo extends PaneInfo {
  agent: string;
  agent_status: string;
}

export interface SessionSnapshot {
  version: string;
  protocol: number;
  focused_workspace_id?: string;
  focused_tab_id?: string;
  focused_pane_id?: string;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts?: PaneLayoutSnapshot[];
  agents?: AgentInfo[];
  repositories?: RepositoryWorktreeInventory[];
  projects?: ProjectInfo[];
  worktrees?: WorktreeInfo[];
  threads?: ThreadInfo[];
}

export type SessionFeedStatus = "connecting" | "live" | "stale";

export interface SessionFeedState {
  status: SessionFeedStatus;
  revision: number;
  snapshot?: SessionSnapshot;
  message?: string;
}
