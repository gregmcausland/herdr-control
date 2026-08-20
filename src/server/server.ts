import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type {
  TerminalClientMessage,
  TerminalMode,
  TerminalServerMessage,
  ThreadCreationRequest,
} from "../shared/protocol.js";
import {
  ClipboardImageError,
  ClipboardImageStore,
  MAX_CLIPBOARD_IMAGE_BYTES,
} from "./clipboard-image.js";
import { HerdrAdapter } from "./herdr.js";
import { HerdrSocketSource } from "./herdr-socket.js";
import { LiveSession, type SessionStateFeed } from "./live-session.js";
import { isOriginAllowed, type ServerConfig } from "./config.js";
import {
  ThreadManager,
  ThreadNotDeletableError,
  ThreadNotFoundError,
  ThreadNotRestorableError,
} from "./threads.js";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const clientRoot = resolve(process.cwd(), "dist/client");

export function createControlServer(
  config: ServerConfig,
  herdr = new HerdrAdapter(config.herdrBinary, config.herdrSocketPath),
  providedSession?: SessionStateFeed,
  providedThreads?: ThreadManager,
) {
  const threads = providedThreads ?? new ThreadManager({
    path: config.statePath,
    retirePane: (paneId) => herdr.retirePane(paneId),
    restoreThread: (request) => herdr.restoreThread(request),
  });
  const session = providedSession ?? new LiveSession(
    new HerdrSocketSource(config.herdrSocketPath),
    1_000,
    50,
    (snapshot) => threads.reconcile(snapshot),
  );
  const clipboardImages = new ClipboardImageStore();
  const server = createServer(async (request, response) => {
    setCorsHeaders(request, response, config.allowedOrigins);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (!isOriginAllowed(request, config.allowedOrigins)) {
      sendJson(response, 403, { error: "Origin not allowed" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      try {
        sendJson(response, 200, session.current().snapshot ?? threads.reconcile(await herdr.snapshot()));
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : "Herdr snapshot failed" });
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session/events") {
      serveSessionEvents(request, response, session);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/clipboard-image") {
      try {
        const image = await readBody(request, MAX_CLIPBOARD_IMAGE_BYTES);
        const path = await clipboardImages.stage(request.headers["content-type"], image);
        sendJson(response, 201, { path });
      } catch (error) {
        const status = error instanceof ClipboardImageError ? error.statusCode : 500;
        const message = error instanceof ClipboardImageError ? error.message : "Unable to stage clipboard image";
        sendJson(response, status, { error: message });
      }
      return;
    }
    const creationProjectId = projectThreadCreationFromPath(url.pathname);
    if (request.method === "POST" && creationProjectId) {
      try {
        const creation = threadCreationRequest(await readJsonBody(request, 128 * 1024));
        const project = threads.getProject(creationProjectId);
        if (!project) {
          sendJson(response, 404, { error: `Project ${creationProjectId} was not found` });
          return;
        }
        const projectWorktrees = threads.listWorktrees().filter(
          (worktree) => worktree.project_id === project.project_id && !worktree.removed_at,
        );
        const selectedWorktree = creation.location.kind === "worktree"
          ? threads.getWorktree(creation.location.worktree_id)
          : undefined;
        if (
          creation.location.kind === "worktree"
          && (!selectedWorktree || selectedWorktree.project_id !== project.project_id || selectedWorktree.removed_at)
        ) {
          sendJson(response, 404, { error: "The selected Worktree was not found in this Project" });
          return;
        }
        const projectWorkspaceId = projectWorktrees.find(
          (worktree) => worktree.checkout_path === project.repo_root && worktree.runtime_workspace_id,
        )?.runtime_workspace_id ?? projectWorktrees.find(
          (worktree) => worktree.runtime_workspace_id,
        )?.runtime_workspace_id;
        const result = await herdr.createThread({
          project,
          projectWorkspaceId,
          worktree: selectedWorktree,
          creation,
        });
        session.requestRefresh?.();
        sendJson(response, 201, { thread: result });
      } catch (error) {
        const invalid = error instanceof RequestBodyError;
        sendJson(response, invalid ? 400 : 502, {
          error: error instanceof Error ? error.message : "Unable to create Thread",
        });
      }
      return;
    }
    const threadAction = threadActionFromPath(url.pathname);
    if (request.method === "POST" && threadAction) {
      try {
        const thread = threadAction.action === "archive"
          ? await threads.archive(threadAction.threadId)
          : await threads.restore(threadAction.threadId);
        session.requestRefresh?.();
        sendJson(response, 200, { thread });
      } catch (error) {
        const status = error instanceof ThreadNotFoundError
          ? 404
          : error instanceof ThreadNotRestorableError
            ? 409
            : 502;
        sendJson(response, status, {
          error: error instanceof Error ? error.message : `Unable to ${threadAction.action} Thread`,
        });
      }
      return;
    }
    const threadId = threadIdFromPath(url.pathname);
    if (request.method === "DELETE" && threadId) {
      try {
        // A fresh snapshot prevents deleting a Thread whose first session reference just appeared.
        threads.reconcile(await herdr.snapshot());
        threads.deleteThread(threadId);
        session.requestRefresh?.();
        response.writeHead(204).end();
      } catch (error) {
        const status = error instanceof ThreadNotFoundError
          ? 404
          : error instanceof ThreadNotDeletableError
            ? 409
            : 502;
        sendJson(response, status, {
          error: error instanceof Error ? error.message : "Unable to delete Thread",
        });
      }
      return;
    }
    const paneId = paneIdFromPath(url.pathname);
    if (request.method === "DELETE" && paneId) {
      try {
        // Destructive decisions must use current Herdr truth, never the retained stale projection.
        const snapshot = threads.reconcile(await herdr.snapshot());
        const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
        const agentPane = pane?.agent || snapshot.agents?.some((agent) => agent.pane_id === paneId);
        if (!pane) {
          sendJson(response, 404, { error: `Pane ${paneId} was not found` });
        } else if (agentPane) {
          sendJson(response, 409, { error: "Agent panes must be archived" });
        } else {
          threads.deletePane(paneId);
          session.requestRefresh?.();
          response.writeHead(204).end();
        }
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : "Unable to delete pane" });
      }
      return;
    }
    if (request.method === "GET") {
      serveClient(url.pathname, response);
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/terminal" || !isOriginAllowed(request, config.allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit("connection", webSocket, request));
  });

  sockets.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const target = url.searchParams.get("target")?.trim();
    const mode = url.searchParams.get("mode") as TerminalMode | null;
    const cols = positiveInteger(url.searchParams.get("cols"), 80);
    const rows = positiveInteger(url.searchParams.get("rows"), 24);
    const takeover = url.searchParams.get("takeover") === "true";

    if (!target || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(target) || (mode !== "control" && mode !== "observe")) {
      socket.send(JSON.stringify({ type: "error", message: "A target and valid mode are required" }));
      socket.close(1008, "Invalid terminal request");
      return;
    }

    const send = (message: TerminalServerMessage) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 4 * 1_024 * 1_024) {
        socket.close(1013, "Terminal client is too slow");
        return;
      }
      socket.send(JSON.stringify(message));
    };

    let attached = false;
    const terminal = herdr.connectTerminal({ target, mode, takeover, cols, rows }, (message) => {
      if (message.type === "frame" && !attached) {
        attached = true;
        send({ type: "ready", mode });
      } else if (message.type === "closed" || message.type === "occupied") {
        attached = false;
      }
      send(message);
    });
    void herdr.focusPane(target).catch((error: unknown) => {
      send({ type: "error", message: error instanceof Error ? error.message : "Unable to mark pane as viewed" });
    });

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as TerminalClientMessage;
        if (!isClientMessage(message)) throw new Error("Invalid terminal command");
        if (message.type === "view") {
          void herdr.focusPane(target).catch((error: unknown) => {
            send({ type: "error", message: error instanceof Error ? error.message : "Unable to mark pane as viewed" });
          });
          return;
        }
        if (message.type === "release") attached = false;
        if (mode === "observe" && message.type !== "release") return;
        if (mode === "control" && !attached && message.type !== "release") return;
        terminal.send(message);
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Invalid terminal command" });
      }
    });
    socket.on("close", () => terminal.dispose());
    socket.on("error", () => terminal.dispose());
  });

  server.on("close", () => {
    session.close();
    threads.close();
  });

  return server;
}

function serveSessionEvents(
  request: IncomingMessage,
  response: ServerResponse,
  session: SessionStateFeed,
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();

  const unsubscribe = session.subscribe((state) => {
    response.write(`data: ${JSON.stringify(state)}\n\n`);
  });
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
  heartbeat.unref();
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1_000 ? parsed : fallback;
}

function isClientMessage(message: TerminalClientMessage): boolean {
  if (!message || typeof message !== "object") return false;
  if (message.type === "release") return true;
  if (message.type === "view") return true;
  if (message.type === "input") return typeof message.data === "string";
  if (message.type === "key") return /^[a-z0-9]+(?:\+[a-z0-9]+)*$/.test(message.key);
  if (message.type === "resize") {
    return (
      Number.isInteger(message.cols) &&
      message.cols > 0 &&
      Number.isInteger(message.rows) &&
      message.rows > 0
    );
  }
  return (
    message.type === "scroll" &&
    (message.source === "wheel" || message.source === "page_key") &&
    (message.direction === "up" || message.direction === "down") &&
    Number.isInteger(message.lines) &&
    message.lines > 0 &&
    message.lines <= 1_000 &&
    (message.column === undefined || (Number.isInteger(message.column) && message.column >= 0)) &&
    (message.row === undefined || (Number.isInteger(message.row) && message.row >= 0))
  );
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): void {
  const origin = request.headers.origin;
  if (origin && isOriginAllowed(request, allowedOrigins)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function threadActionFromPath(pathname: string): { threadId: string; action: "archive" | "restore" } | undefined {
  const match = /^\/api\/threads\/([^/]+)\/(archive|restore)$/.exec(pathname);
  if (!match) return undefined;
  const threadId = decodeIdentifier(match[1]);
  return threadId ? { threadId, action: match[2] as "archive" | "restore" } : undefined;
}

function projectThreadCreationFromPath(pathname: string): string | undefined {
  const match = /^\/api\/projects\/([^/]+)\/threads$/.exec(pathname);
  return match ? decodeIdentifier(match[1]) : undefined;
}

function threadIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/threads\/([^/]+)$/.exec(pathname);
  return match ? decodeIdentifier(match[1]) : undefined;
}

function paneIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/panes\/([^/]+)$/.exec(pathname);
  return match ? decodeIdentifier(match[1]) : undefined;
}

function decodeIdentifier(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    return Promise.reject(new ClipboardImageError("Clipboard image exceeds the 16 MiB limit", 413));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        chunks.length = 0;
        request.resume();
        reject(new ClipboardImageError("Clipboard image exceeds the 16 MiB limit", 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks, total));
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
    request.on("aborted", () => {
      if (!settled) reject(new Error("Clipboard image upload was interrupted"));
    });
  });
}

class RequestBodyError extends Error {}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  try {
    const body = await readBody(request, maxBytes);
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (error instanceof ClipboardImageError) throw new RequestBodyError("Request body is too large");
    if (error instanceof SyntaxError) throw new RequestBodyError("Request body must be valid JSON");
    throw error;
  }
}

function threadCreationRequest(value: unknown): ThreadCreationRequest {
  const request = record(value);
  const location = record(request?.location);
  const agent = requiredText(request?.agent, "Agent kind", 32);
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(agent)) {
    throw new RequestBodyError("Agent kind is invalid");
  }
  const title = optionalText(request?.title, "Title", 200);
  const prompt = optionalText(request?.prompt, "Initial message", 100_000);
  const skipPermissions = optionalBoolean(request?.skip_permissions, "Skip permissions");
  if (!location) throw new RequestBodyError("A valid Thread location is required");
  const kind = location?.kind;
  if (kind === "project") return { agent, title, prompt, skip_permissions: skipPermissions, location: { kind } };
  if (kind === "worktree") {
    return {
      agent,
      title,
      prompt,
      skip_permissions: skipPermissions,
      location: { kind, worktree_id: requiredIdentifier(location.worktree_id, "Worktree") },
    };
  }
  if (kind === "create_worktree") {
    return {
      agent,
      title,
      prompt,
      skip_permissions: skipPermissions,
      location: {
        kind,
        branch: optionalText(location.branch, "Branch", 512),
        base: optionalText(location.base, "Base", 512),
        path: optionalText(location.path, "Checkout path", 4_096),
        label: optionalText(location.label, "Worktree label", 120),
      },
    };
  }
  if (kind === "open_worktree") {
    return {
      agent,
      title,
      prompt,
      skip_permissions: skipPermissions,
      location: {
        kind,
        path: requiredText(location.path, "Checkout path", 4_096),
        label: optionalText(location.label, "Worktree label", 120),
      },
    };
  }
  throw new RequestBodyError("A valid Thread location is required");
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new RequestBodyError(`${label} must be true or false`);
  return value || undefined;
}

function requiredIdentifier(value: unknown, label: string): string {
  const identifier = requiredText(value, label, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(identifier)) {
    throw new RequestBodyError(`${label} is invalid`);
  }
  return identifier;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const result = optionalText(value, label, maxLength);
  if (!result) throw new RequestBodyError(`${label} is required`);
  return result;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new RequestBodyError(`${label} must be text`);
  const result = value.trim();
  if (!result) return undefined;
  if (result.length > maxLength) throw new RequestBodyError(`${label} is too long`);
  return result;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function serveClient(pathname: string, response: ServerResponse): void {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(clientRoot, relative);
  const insideClientRoot = candidate === clientRoot || candidate.startsWith(`${clientRoot}${sep}`);
  const file = insideClientRoot && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : resolve(clientRoot, "index.html");

  if (!existsSync(file)) {
    sendJson(response, 404, { error: "Client build not found; run npm run build:client" });
    return;
  }
  response.writeHead(200, { "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}
