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
}

export interface ThreadInfo {
  thread_id: string;
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
  threads?: ThreadInfo[];
}

export type SessionFeedStatus = "connecting" | "live" | "stale";

export interface SessionFeedState {
  status: SessionFeedStatus;
  revision: number;
  snapshot?: SessionSnapshot;
  message?: string;
}
