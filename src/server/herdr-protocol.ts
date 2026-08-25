import type {
  AgentInfo,
  AgentSessionReference,
  PaneInfo,
  PaneLayoutSnapshot,
  RepositoryWorktreeInfo,
  RepositoryWorktreeInventory,
  SessionSnapshot,
  TabInfo,
  TerminalServerMessage,
  WorkspaceInfo,
} from "../shared/protocol.js";

export interface HerdrThreadLocation {
  workspaceId: string;
  tabId: string;
  paneId: string;
}

export interface HerdrRestoreLocation {
  kind: "tab" | "workspace";
  id: string;
  paneId: string;
}

interface ExpectedAgent {
  paneId: string;
  name: string;
  kind: string;
}

/** Converts an untrusted Herdr snapshot response into Control's runtime model. */
export function sessionSnapshotFromHerdrResponse(value: unknown): SessionSnapshot {
  const result = responseResult(value, "Herdr returned no session snapshot");
  try {
    return sessionSnapshotFromValue(result.snapshot);
  } catch (error) {
    throw invalid("session snapshot", error);
  }
}

/** Converts Herdr's terminal NDJSON vocabulary into Control terminal messages. */
export function terminalMessageFromHerdrRecord(value: unknown): TerminalServerMessage {
  try {
    const record = requiredRecord(value, "record");
    const type = requiredString(record.type, "type");
    if (type === "terminal.frame") {
      return {
        type: "frame",
        seq: requiredInteger(record.seq, "seq", 0),
        cols: requiredInteger(record.width, "width", 1),
        rows: requiredInteger(record.height, "height", 1),
        full: requiredBoolean(record.full, "full"),
        data: requiredString(record.bytes, "bytes", true),
      };
    }
    if (type !== "terminal.closed") throw new ProtocolValueError("type is unsupported");

    const reason = optionalString(record.reason, "reason") ?? "Herdr closed the terminal session";
    if (reason.includes("already has an attached client") || reason.includes("terminal attach taken over")) {
      return { type: "occupied", message: reason };
    }
    return { type: "closed", reason };
  } catch (error) {
    throw invalid("terminal record", error);
  }
}

/** Returns no inventory unless Herdr supplied one complete repository inventory. */
export function worktreeInventoryFromHerdrResponse(
  value: unknown,
): RepositoryWorktreeInventory | undefined {
  try {
    const result = responseResult(value, "Herdr returned no Worktree inventory");
    const source = requiredRecord(result.source, "result.source");
    const worktrees = requiredArray(result.worktrees, "result.worktrees").map(
      (worktree, index) => worktreeFromValue(worktree, `result.worktrees[${index}]`),
    );
    return {
      repo_key: requiredString(source.repo_key, "result.source.repo_key"),
      repo_name: requiredString(source.repo_name, "result.source.repo_name"),
      repo_root: requiredString(source.repo_root, "result.source.repo_root"),
      source_checkout_path: requiredString(
        source.source_checkout_path,
        "result.source.source_checkout_path",
      ),
      source_workspace_id: optionalString(
        source.source_workspace_id,
        "result.source.source_workspace_id",
      ),
      worktrees,
    };
  } catch {
    // Reconciliation treats an inventory as complete. A partial record must not
    // imply that an absent durable Worktree was removed.
    return undefined;
  }
}

export function threadLocationFromHerdrResponse(value: unknown): HerdrThreadLocation {
  try {
    return threadLocationFromResult(responseResult(value, "Herdr returned no Thread location"));
  } catch (error) {
    throw invalid("Thread location", error);
  }
}

export function worktreeOpenFromHerdrResponse(
  value: unknown,
): HerdrThreadLocation & { alreadyOpen: boolean } {
  try {
    const result = responseResult(value, "Herdr returned no Worktree location");
    const alreadyOpen = result.already_open === undefined || result.already_open === null
      ? false
      : requiredBoolean(result.already_open, "result.already_open");
    return { ...threadLocationFromResult(result), alreadyOpen };
  } catch (error) {
    throw invalid("Worktree location", error);
  }
}

/** Interprets Herdr's evolving agent response without leaking its readiness fields. */
export function agentIsReadyFromHerdrResponse(value: unknown, expected: ExpectedAgent): boolean {
  try {
    const result = responseResult(value, "Herdr returned no agent result");
    if (result.agent === undefined || result.agent === null) return false;
    const agent = requiredRecord(result.agent, "result.agent");
    const paneId = requiredString(agent.pane_id, "result.agent.pane_id");
    const kind = requiredString(agent.agent, "result.agent.agent");
    const name = optionalString(agent.name, "result.agent.name");
    if (name && name !== expected.name) {
      throw new Error(`Herdr started an unexpected agent in ${expected.paneId}`);
    }
    const interactiveReady = optionalBoolean(agent.interactive_ready, "result.agent.interactive_ready");
    const launchPending = optionalBoolean(agent.launch_pending, "result.agent.launch_pending");
    return paneId === expected.paneId
      && kind === expected.kind
      && interactiveReady !== false
      && launchPending !== true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Herdr started an unexpected agent")) throw error;
    throw invalid("agent response", error);
  }
}

export function restoreLocationFromHerdrResponse(
  value: unknown,
  kind: "tab" | "workspace",
): HerdrRestoreLocation {
  try {
    const result = responseResult(value, `Herdr returned no restored ${kind}`);
    const pane = requiredRecord(result.root_pane, "result.root_pane");
    const resource = requiredRecord(result[kind], `result.${kind}`);
    return {
      kind,
      id: requiredString(resource[`${kind}_id`], `result.${kind}.${kind}_id`),
      paneId: requiredString(pane.pane_id, "result.root_pane.pane_id"),
    };
  } catch (error) {
    throw invalid(`restored ${kind}`, error);
  }
}

function sessionSnapshotFromValue(value: unknown): SessionSnapshot {
  const snapshot = requiredRecord(value, "snapshot");
  const workspaces = requiredArray(snapshot.workspaces, "workspaces").map(
    (workspace, index) => workspaceFromValue(workspace, `workspaces[${index}]`),
  );
  const tabs = requiredArray(snapshot.tabs, "tabs").map(
    (tab, index) => tabFromValue(tab, `tabs[${index}]`),
  );
  const panes = requiredArray(snapshot.panes, "panes").map(
    (pane, index) => paneFromValue(pane, `panes[${index}]`),
  );
  const layouts = optionalArray(snapshot.layouts, "layouts")?.map(
    (layout, index) => layoutFromValue(layout, `layouts[${index}]`),
  );
  const agents = optionalArray(snapshot.agents, "agents")?.map(
    (agent, index) => agentFromValue(agent, `agents[${index}]`),
  );

  return {
    version: requiredString(snapshot.version, "version"),
    protocol: requiredInteger(snapshot.protocol, "protocol", 0),
    focused_workspace_id: optionalString(snapshot.focused_workspace_id, "focused_workspace_id"),
    focused_tab_id: optionalString(snapshot.focused_tab_id, "focused_tab_id"),
    focused_pane_id: optionalString(snapshot.focused_pane_id, "focused_pane_id"),
    workspaces,
    tabs,
    panes,
    layouts,
    agents,
  };
}

function workspaceFromValue(value: unknown, path: string): WorkspaceInfo {
  const workspace = requiredRecord(value, path);
  const worktree = workspace.worktree === null
    ? null
    : workspace.worktree === undefined
      ? undefined
      : workspaceWorktreeFromValue(workspace.worktree, `${path}.worktree`);
  return {
    workspace_id: requiredString(workspace.workspace_id, `${path}.workspace_id`),
    label: requiredString(workspace.label, `${path}.label`, true),
    number: requiredInteger(workspace.number, `${path}.number`, 0),
    tab_count: requiredInteger(workspace.tab_count, `${path}.tab_count`, 0),
    pane_count: requiredInteger(workspace.pane_count, `${path}.pane_count`, 0),
    focused: requiredBoolean(workspace.focused, `${path}.focused`),
    worktree,
  };
}

function workspaceWorktreeFromValue(value: unknown, path: string): NonNullable<WorkspaceInfo["worktree"]> {
  const worktree = requiredRecord(value, path);
  return {
    checkout_path: requiredString(worktree.checkout_path, `${path}.checkout_path`),
    is_linked_worktree: requiredBoolean(worktree.is_linked_worktree, `${path}.is_linked_worktree`),
    repo_key: requiredString(worktree.repo_key, `${path}.repo_key`),
    repo_name: requiredString(worktree.repo_name, `${path}.repo_name`),
    repo_root: requiredString(worktree.repo_root, `${path}.repo_root`),
  };
}

function tabFromValue(value: unknown, path: string): TabInfo {
  const tab = requiredRecord(value, path);
  return {
    tab_id: requiredString(tab.tab_id, `${path}.tab_id`),
    workspace_id: requiredString(tab.workspace_id, `${path}.workspace_id`),
    label: requiredString(tab.label, `${path}.label`, true),
    number: requiredInteger(tab.number, `${path}.number`, 0),
    pane_count: requiredInteger(tab.pane_count, `${path}.pane_count`, 0),
    focused: requiredBoolean(tab.focused, `${path}.focused`),
  };
}

function paneFromValue(value: unknown, path: string): PaneInfo {
  const pane = requiredRecord(value, path);
  return {
    pane_id: requiredString(pane.pane_id, `${path}.pane_id`),
    tab_id: requiredString(pane.tab_id, `${path}.tab_id`),
    workspace_id: requiredString(pane.workspace_id, `${path}.workspace_id`),
    terminal_id: requiredString(pane.terminal_id, `${path}.terminal_id`),
    label: optionalString(pane.label, `${path}.label`),
    terminal_title: optionalString(pane.terminal_title, `${path}.terminal_title`),
    terminal_title_stripped: optionalString(pane.terminal_title_stripped, `${path}.terminal_title_stripped`),
    cwd: optionalString(pane.cwd, `${path}.cwd`),
    foreground_cwd: optionalString(pane.foreground_cwd, `${path}.foreground_cwd`),
    agent: optionalString(pane.agent, `${path}.agent`),
    name: optionalString(pane.name, `${path}.name`),
    agent_status: optionalString(pane.agent_status, `${path}.agent_status`),
    agent_session: optionalAgentSession(pane.agent_session, `${path}.agent_session`),
    display_agent: optionalString(pane.display_agent, `${path}.display_agent`),
    state_labels: optionalStringRecord(pane.state_labels, `${path}.state_labels`),
    working_started_at: optionalString(pane.working_started_at, `${path}.working_started_at`),
    last_work_duration_ms: optionalNumber(pane.last_work_duration_ms, `${path}.last_work_duration_ms`, 0),
    focused: requiredBoolean(pane.focused, `${path}.focused`),
  };
}

function agentFromValue(value: unknown, path: string): AgentInfo {
  const pane = paneFromValue(value, path);
  const agent = requiredString(pane.agent, `${path}.agent`);
  const agentStatus = requiredString(pane.agent_status, `${path}.agent_status`);
  return { ...pane, agent, agent_status: agentStatus };
}

function layoutFromValue(value: unknown, path: string): PaneLayoutSnapshot {
  const layout = requiredRecord(value, path);
  return {
    ...layout,
    workspace_id: requiredString(layout.workspace_id, `${path}.workspace_id`),
    tab_id: requiredString(layout.tab_id, `${path}.tab_id`),
    focused_pane_id: optionalString(layout.focused_pane_id, `${path}.focused_pane_id`),
    zoomed: optionalBoolean(layout.zoomed, `${path}.zoomed`),
  };
}

function optionalAgentSession(value: unknown, path: string): AgentSessionReference | undefined {
  if (value === undefined || value === null) return undefined;
  const session = requiredRecord(value, path);
  return {
    source: requiredString(session.source, `${path}.source`),
    agent: requiredString(session.agent, `${path}.agent`),
    kind: requiredString(session.kind, `${path}.kind`),
    value: requiredString(session.value, `${path}.value`),
  };
}

function optionalStringRecord(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const record = requiredRecord(value, path);
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    requiredString(entry, `${path}.${key}`, true),
  ]));
}

function worktreeFromValue(value: unknown, path: string): RepositoryWorktreeInfo {
  const worktree = requiredRecord(value, path);
  return {
    path: requiredString(worktree.path, `${path}.path`),
    label: requiredString(worktree.label, `${path}.label`, true),
    branch: optionalString(worktree.branch, `${path}.branch`),
    is_bare: requiredBoolean(worktree.is_bare, `${path}.is_bare`),
    is_detached: requiredBoolean(worktree.is_detached, `${path}.is_detached`),
    is_linked_worktree: requiredBoolean(worktree.is_linked_worktree, `${path}.is_linked_worktree`),
    is_prunable: requiredBoolean(worktree.is_prunable, `${path}.is_prunable`),
    open_workspace_id: optionalString(worktree.open_workspace_id, `${path}.open_workspace_id`),
  };
}

function threadLocationFromResult(result: Record<string, unknown>): HerdrThreadLocation {
  const workspace = optionalRecord(result.workspace, "result.workspace");
  const tab = requiredRecord(result.tab, "result.tab");
  const pane = requiredRecord(result.root_pane, "result.root_pane");
  const workspaceId = optionalString(workspace?.workspace_id, "result.workspace.workspace_id")
    ?? requiredString(tab.workspace_id, "result.tab.workspace_id");
  return {
    workspaceId,
    tabId: requiredString(tab.tab_id, "result.tab.tab_id"),
    paneId: requiredString(pane.pane_id, "result.root_pane.pane_id"),
  };
}

function responseResult(value: unknown, fallback: string): Record<string, unknown> {
  const response = requiredRecord(value, "response");
  if (response.error !== undefined && response.error !== null) {
    const error = requiredRecord(response.error, "error");
    throw new Error(optionalString(error.message, "error.message") ?? fallback);
  }
  return requiredRecord(response.result, "result");
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  const result = optionalRecord(value, path);
  if (!result) throw new ProtocolValueError(`${path} must be an object`);
  return result;
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolValueError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ProtocolValueError(`${path} must be an array`);
  return value;
}

function optionalArray(value: unknown, path: string): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredArray(value, path);
}

function requiredString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new ProtocolValueError(`${path} must be ${allowEmpty ? "text" : "non-empty text"}`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, path, true);
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ProtocolValueError(`${path} must be true or false`);
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredBoolean(value, path);
}

function requiredInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new ProtocolValueError(`${path} must be an integer of at least ${minimum}`);
  }
  return value as number;
}

function optionalNumber(value: unknown, path: string, minimum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new ProtocolValueError(`${path} must be a number of at least ${minimum}`);
  }
  return value;
}

function invalid(subject: string, error: unknown): Error {
  if (error instanceof Error && !(error instanceof ProtocolValueError)) return error;
  const detail = error instanceof Error ? `: ${error.message}` : "";
  return new Error(`Herdr returned an invalid ${subject}${detail}`);
}

class ProtocolValueError extends Error {}
