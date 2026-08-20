import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type {
  AgentSessionReference,
  ProjectInfo,
  SessionSnapshot,
  TerminalClientMessage,
  TerminalMode,
  TerminalServerMessage,
  ThreadCreationRequest,
  ThreadCreationResult,
  WorktreeInfo,
} from "../shared/protocol.js";
import type { ThreadRestoreRequest } from "./threads.js";
import { HerdrRequestError, requestHerdr } from "./herdr-socket.js";

type HerdrSocketRequest = typeof requestHerdr;

const AGENT_START_TIMEOUT_MS = 60_000;
const AGENT_READY_POLL_MS = 100;

export interface HerdrThreadCreationRequest {
  project: ProjectInfo;
  projectWorkspaceId?: string;
  worktree?: WorktreeInfo;
  creation: ThreadCreationRequest;
}

interface HerdrFrame {
  type: "terminal.frame";
  seq: number;
  width: number;
  height: number;
  full: boolean;
  bytes: string;
}

interface HerdrClosed {
  type: "terminal.closed";
  reason?: string;
}

type HerdrRecord = HerdrFrame | HerdrClosed;

export function translateHerdrRecord(record: HerdrRecord): TerminalServerMessage {
  if (record.type === "terminal.frame") {
    return {
      type: "frame",
      seq: record.seq,
      cols: record.width,
      rows: record.height,
      full: record.full,
      data: record.bytes,
    };
  }

  const reason = record.reason ?? "Herdr closed the terminal session";
  if (reason.includes("already has an attached client") || reason.includes("terminal attach taken over")) {
    return { type: "occupied", message: reason };
  }
  return { type: "closed", reason };
}

const LEGACY_KEYS: Record<string, string> = {
  "\r": "enter",
  "\x1b": "esc",
  "\x03": "ctrl+c",
  "\t": "tab",
  "\x7f": "backspace",
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1b[3~": "delete",
  "\x1b[H": "home",
  "\x1b[F": "end",
};

export function logicalKeyFromLegacyInput(data: string): string | undefined {
  return LEGACY_KEYS[data];
}

export function resumeArgsFor(agent: string, session: AgentSessionReference): string[] {
  if (agent === "codex" && session.kind === "id") return ["resume", session.value];
  if (agent === "claude" && session.kind === "id") return ["--resume", session.value];
  if (agent === "pi" && (session.kind === "id" || session.kind === "path")) {
    return ["--session", session.value];
  }
  throw new Error(`${agent} sessions of kind ${session.kind} cannot be restored yet`);
}

/** Translates Control's single launch policy into each harness's native argument. */
export function permissionBypassArgsFor(agent: string, enabled: boolean): string[] {
  if (!enabled) return [];
  if (agent === "codex") return ["--dangerously-bypass-approvals-and-sandbox"];
  if (agent === "claude") return ["--dangerously-skip-permissions"];
  if (agent === "gemini") return ["--approval-mode=yolo"];
  if (agent === "pi") return ["--approve"];
  if (agent === "opencode") return ["--auto"];
  throw new Error(`${agent} does not have a configured permission-bypass launch mode`);
}

export class HerdrTerminalConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private stderr = "";
  private receivedClose = false;
  private disposed = false;
  private attached = false;
  private keyQueue: Promise<unknown> = Promise.resolve();

  constructor(
    binary: string,
    private readonly socketPath: string,
    private readonly target: string,
    mode: TerminalMode,
    takeover: boolean,
    cols: number,
    rows: number,
    private readonly emit: (message: TerminalServerMessage) => void,
  ) {
    const args = ["terminal", "session", mode, target, "--cols", String(cols), "--rows", String(rows)];
    if (mode === "control" && takeover) args.push("--takeover");

    this.child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });

    lines.on("line", (line) => {
      try {
        const message = translateHerdrRecord(JSON.parse(line) as HerdrRecord);
        if (message.type === "frame") this.attached = true;
        if (message.type === "closed" || message.type === "occupied") {
          this.attached = false;
          this.receivedClose = true;
        }
        this.emit(message);
      } catch {
        this.emit({ type: "error", message: "Herdr emitted an invalid terminal record" });
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8_192);
    });
    this.child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // Herdr may close immediately after release or takeover. The ownership is
      // already gone, so a racing detach write has nothing left to accomplish.
      if (error.code !== "EPIPE") {
        this.emit({ type: "error", message: `Herdr terminal input failed: ${error.message}` });
      }
    });

    this.child.on("error", (error) => {
      this.emit({ type: "error", message: `Unable to start Herdr: ${error.message}` });
    });

    this.child.on("close", (code) => {
      if (this.disposed || this.receivedClose) return;
      const detail = this.stderr.trim();
      this.emit({
        type: "closed",
        reason: detail || `Herdr terminal process exited${code === null ? "" : ` with code ${code}`}`,
      });
    });
  }

  send(message: TerminalClientMessage): void {
    if (this.disposed || !this.child.stdin.writable) return;
    if (message.type === "release") {
      this.attached = false;
      this.write({ type: "terminal.release" });
      return;
    }
    if (!this.attached) return;

    const logicalKey = message.type === "key"
      ? message.key
      : message.type === "input"
        ? logicalKeyFromLegacyInput(message.data)
        : undefined;
    if (logicalKey) {
      this.queueKey(logicalKey);
    } else if (message.type === "input") {
      this.write({ type: "terminal.input", text: message.data });
    } else if (message.type === "resize") {
      this.write({ type: "terminal.resize", cols: message.cols, rows: message.rows });
    } else if (message.type === "scroll") {
      this.write({
        type: "terminal.scroll",
        source: message.source,
        direction: message.direction,
        lines: message.lines,
        column: message.column,
        row: message.row,
      });
    } else {
      this.write({ type: "terminal.release" });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attached = false;
    if (this.child.stdin.writable) {
      this.write({ type: "terminal.release" });
      this.child.stdin.end();
    }
    const timer = setTimeout(() => this.child.kill(), 1_000);
    timer.unref();
  }

  private write(message: object): void {
    if (this.child.exitCode !== null || this.child.stdin.destroyed || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private queueKey(key: string): void {
    this.keyQueue = this.keyQueue
      .then(() => {
        if (this.disposed || !this.attached) return;
        return requestHerdr(this.socketPath, "pane.send_keys", {
          pane_id: this.target,
          keys: [key],
        });
      })
      .catch((error: unknown) => {
        this.emit({
          type: "error",
          message: error instanceof Error ? error.message : "Herdr rejected terminal input",
        });
      });
  }
}

export class HerdrAdapter {
  constructor(
    private readonly binary = "herdr",
    private readonly socketPath = "",
    private readonly socketRequest: HerdrSocketRequest = requestHerdr,
  ) {}

  async snapshot(): Promise<SessionSnapshot> {
    const stdout = await this.run(["api", "snapshot"]);
    const response = JSON.parse(stdout) as { result?: { snapshot?: SessionSnapshot }; error?: { message?: string } };
    const snapshot = response.result?.snapshot;
    if (!snapshot) throw new Error(response.error?.message ?? "Herdr returned no session snapshot");
    return snapshot;
  }

  connectTerminal(
    options: {
      target: string;
      mode: TerminalMode;
      takeover: boolean;
      cols: number;
      rows: number;
    },
    emit: (message: TerminalServerMessage) => void,
  ): HerdrTerminalConnection {
    return new HerdrTerminalConnection(
      this.binary,
      this.socketPath,
      options.target,
      options.mode,
      options.takeover,
      options.cols,
      options.rows,
      emit,
    );
  }

  async focusPane(target: string): Promise<void> {
    await this.socketRequest(this.socketPath, "pane.focus", { pane_id: target });
  }

  async closePane(target: string): Promise<void> {
    await this.socketRequest(this.socketPath, "pane.close", { pane_id: target });
  }

  /** Retires a pane when safe, or reports that it remains a worktree anchor. */
  async retirePane(target: string): Promise<"retired" | "retained"> {
    try {
      await this.closePane(target);
      return "retired";
    } catch (error) {
      if (error instanceof HerdrRequestError && error.code === "confirmation_required") return "retained";
      if (error instanceof HerdrRequestError && error.code === "pane_not_found") return "retired";
      throw error;
    }
  }

  async restoreThread(request: ThreadRestoreRequest): Promise<void> {
    const resumeArgs = resumeArgsFor(request.agent, request.session);
    const location = await this.createRestoreLocation(request);

    try {
      await this.run([
        "agent",
        "start",
        request.agentName,
        "--kind",
        request.agent,
        "--pane",
        location.paneId,
        "--timeout",
        "60000",
        "--",
        ...resumeArgs,
      ]);
    } catch (error) {
      await this.run([location.kind, "close", location.id]).catch(() => undefined);
      throw error;
    }
  }

  /** Creates one dedicated Herdr tab, starts its agent, then optionally prompts it. */
  async createThread(request: HerdrThreadCreationRequest): Promise<ThreadCreationResult> {
    const title = creationTitle(request.creation);
    const agentName = creationAgentName(title, request.creation.agent);
    const location = await this.createThreadLocation(request, title);
    await this.socketRequest(this.socketPath, "pane.rename", {
      pane_id: location.paneId,
      label: title,
    });
    const started = await this.socketRequest(this.socketPath, "agent.start", {
      name: agentName,
      kind: request.creation.agent,
      pane_id: location.paneId,
      timeout_ms: AGENT_START_TIMEOUT_MS,
      args: permissionBypassArgsFor(request.creation.agent, Boolean(request.creation.skip_permissions)),
    });
    await this.waitForStartedAgent(location.paneId, agentName, request.creation.agent, started);
    const prompt = request.creation.prompt?.trim();
    if (prompt) {
      await this.socketRequest(this.socketPath, "agent.prompt", {
        target: location.paneId,
        text: prompt,
      });
    }
    return {
      agent_name: agentName,
      workspace_id: location.workspaceId,
      tab_id: location.tabId,
      pane_id: location.paneId,
    };
  }

  /** Herdr acknowledges launch before its detector has registered the new agent. */
  private async waitForStartedAgent(
    paneId: string,
    agentName: string,
    agentKind: string,
    started: Record<string, unknown>,
  ): Promise<void> {
    if (agentIsReady(started, paneId, agentName, agentKind)) return;

    const deadline = Date.now() + AGENT_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await this.socketRequest(this.socketPath, "agent.get", { target: paneId });
        const agent = responseAgent(response);
        const detectedName = text(agent?.name);
        if (detectedName && detectedName !== agentName) {
          throw new Error(`Herdr started an unexpected agent in ${paneId}`);
        }
        if (agentIsReady(response, paneId, agentName, agentKind)) return;
      } catch (error) {
        if (!(error instanceof HerdrRequestError) || error.code !== "agent_not_found") throw error;
      }
      await delay(AGENT_READY_POLL_MS);
    }

    throw new Error(`Herdr did not finish starting ${agentName}`);
  }

  private async createThreadLocation(
    request: HerdrThreadCreationRequest,
    title: string,
  ): Promise<ThreadCreationLocation> {
    const location = request.creation.location;
    if (location.kind === "project") {
      if (request.projectWorkspaceId) {
        try {
          return await this.createThreadTab(request.projectWorkspaceId, request.project.repo_root, title);
        } catch (error) {
          if (!(error instanceof HerdrRequestError) || error.code !== "workspace_not_found") throw error;
        }
      }
      const created = await this.socketRequest(this.socketPath, "workspace.create", {
        cwd: request.project.repo_root,
        label: request.project.name,
        focus: false,
      });
      return this.rootThreadLocation(created, title);
    }

    if (location.kind === "worktree") {
      if (!request.worktree) throw new Error("The selected Worktree was not found");
      if (request.worktree.runtime_workspace_id) {
        try {
          return await this.createThreadTab(
            request.worktree.runtime_workspace_id,
            request.worktree.checkout_path,
            title,
          );
        } catch (error) {
          if (!(error instanceof HerdrRequestError) || error.code !== "workspace_not_found") throw error;
        }
      }
      return this.openWorktreeThread(request.project, request.worktree.checkout_path, undefined, title);
    }

    if (location.kind === "create_worktree") {
      const created = await this.socketRequest(this.socketPath, "worktree.create", compactRecord({
        cwd: request.project.repo_root,
        branch: location.branch?.trim() || undefined,
        base: location.base?.trim() || undefined,
        path: location.path?.trim() || undefined,
        label: location.label?.trim() || undefined,
        focus: false,
      }));
      return this.rootThreadLocation(created, title);
    }

    return this.openWorktreeThread(
      request.project,
      location.path,
      location.label?.trim() || undefined,
      title,
    );
  }

  private async openWorktreeThread(
    project: ProjectInfo,
    path: string,
    label: string | undefined,
    title: string,
  ): Promise<ThreadCreationLocation> {
    const opened = await this.socketRequest(this.socketPath, "worktree.open", compactRecord({
      cwd: project.repo_root,
      path,
      label,
      focus: false,
    }));
    const root = creationLocationFromResponse(opened);
    const result = object(opened.result);
    return result?.already_open === true
      ? this.createThreadTab(root.workspaceId, path, title)
      : this.renameRootThreadTab(root, title);
  }

  private async createThreadTab(
    workspaceId: string,
    cwd: string,
    title: string,
  ): Promise<ThreadCreationLocation> {
    const response = await this.socketRequest(this.socketPath, "tab.create", {
      workspace_id: workspaceId,
      cwd,
      label: title,
      focus: false,
      env: {},
    });
    return creationLocationFromResponse(response);
  }

  private async rootThreadLocation(
    response: Record<string, unknown>,
    title: string,
  ): Promise<ThreadCreationLocation> {
    return this.renameRootThreadTab(creationLocationFromResponse(response), title);
  }

  private async renameRootThreadTab(
    location: ThreadCreationLocation,
    title: string,
  ): Promise<ThreadCreationLocation> {
    await this.socketRequest(this.socketPath, "tab.rename", { tab_id: location.tabId, label: title });
    return location;
  }

  private async createRestoreLocation(request: ThreadRestoreRequest): Promise<RestoreLocation> {
    const cwdArgs = [
      ...(request.cwd ? ["--cwd", request.cwd] : []),
    ];

    try {
      const response = parseHerdrResponse(await this.run([
        "tab",
        "create",
        "--workspace",
        request.workspaceId,
        ...cwdArgs,
        "--label",
        request.title,
        "--no-focus",
      ]));
      const paneId = response.result?.root_pane?.pane_id;
      const tabId = response.result?.tab?.tab_id;
      if (!paneId || !tabId) throw new Error("Herdr returned an incomplete restored tab");
      return { kind: "tab", id: tabId, paneId };
    } catch {
      const response = parseHerdrResponse(await this.run([
        "workspace",
        "create",
        ...cwdArgs,
        "--label",
        request.workspaceLabel,
        "--tab-label",
        request.title,
        "--no-focus",
      ]));
      const paneId = response.result?.root_pane?.pane_id;
      const workspaceId = response.result?.workspace?.workspace_id;
      if (!paneId || !workspaceId) throw new Error("Herdr returned an incomplete restored workspace");
      return { kind: "workspace", id: workspaceId, paneId };
    }
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `Herdr exited with code ${code}`));
      });
    });
  }
}

interface RestoreLocation {
  kind: "tab" | "workspace";
  id: string;
  paneId: string;
}

interface ThreadCreationLocation {
  workspaceId: string;
  tabId: string;
  paneId: string;
}

interface HerdrCreationResponse {
  result?: {
    root_pane?: { pane_id?: string };
    tab?: { tab_id?: string };
    workspace?: { workspace_id?: string };
  };
  error?: { message?: string };
}

function parseHerdrResponse(output: string): HerdrCreationResponse {
  const response = JSON.parse(output) as HerdrCreationResponse;
  if (response.error) throw new Error(response.error.message ?? "Herdr command failed");
  return response;
}

function creationLocationFromResponse(response: Record<string, unknown>): ThreadCreationLocation {
  const result = object(response.result);
  const workspace = object(result?.workspace);
  const tab = object(result?.tab);
  const pane = object(result?.root_pane);
  const workspaceId = text(workspace?.workspace_id) ?? text(tab?.workspace_id);
  const tabId = text(tab?.tab_id);
  const paneId = text(pane?.pane_id);
  if (!workspaceId || !tabId || !paneId) throw new Error("Herdr returned an incomplete Thread location");
  return { workspaceId, tabId, paneId };
}

function responseAgent(response: Record<string, unknown>): Record<string, unknown> | undefined {
  return object(object(response.result)?.agent);
}

function agentIsReady(
  response: Record<string, unknown>,
  paneId: string,
  agentName: string,
  agentKind: string,
): boolean {
  const agent = responseAgent(response);
  return text(agent?.pane_id) === paneId
    && text(agent?.agent) === agentKind
    && (agent?.name === undefined || agent?.name === null || text(agent.name) === agentName)
    // Herdr 0.8 omits these newer schema fields once detection completes.
    && agent?.interactive_ready !== false
    && agent?.launch_pending !== true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function creationTitle(request: ThreadCreationRequest): string {
  const explicit = request.title?.trim();
  if (explicit) return explicit.slice(0, 80);
  const promptLine = request.prompt?.trim().split(/\r?\n/, 1)[0]?.trim();
  if (promptLine) return promptLine.slice(0, 80);
  return `${request.agent.charAt(0).toUpperCase()}${request.agent.slice(1)} thread`;
}

export function creationAgentName(title: string, agent: string, suffix = randomUUID().slice(0, 6)): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const prefix = /^[a-z]/.test(slug) ? slug : `${agent}_${slug}`;
  return `${prefix.slice(0, 24).replace(/_+$/g, "")}_${suffix.toLowerCase()}`.slice(0, 32);
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
