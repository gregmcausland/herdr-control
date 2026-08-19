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
  agent_status?: string;
  display_agent?: string;
  state_labels?: Record<string, string>;
  focused: boolean;
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
}

export type SessionFeedStatus = "connecting" | "live" | "stale";

export interface SessionFeedState {
  status: SessionFeedStatus;
  revision: number;
  snapshot?: SessionSnapshot;
  message?: string;
}
