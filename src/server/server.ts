import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { TerminalClientMessage, TerminalMode, TerminalServerMessage } from "../shared/protocol.js";
import {
  ClipboardImageError,
  ClipboardImageStore,
  MAX_CLIPBOARD_IMAGE_BYTES,
} from "./clipboard-image.js";
import { HerdrAdapter } from "./herdr.js";
import { HerdrSocketSource } from "./herdr-socket.js";
import { LiveSession, type SessionStateFeed } from "./live-session.js";
import { isOriginAllowed, type ServerConfig } from "./config.js";

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
  herdr = new HerdrAdapter(config.herdrBinary),
  session: SessionStateFeed = new LiveSession(new HerdrSocketSource(config.herdrSocketPath)),
) {
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
        sendJson(response, 200, session.current().snapshot ?? await herdr.snapshot());
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

    const terminal = herdr.connectTerminal({ target, mode, takeover, cols, rows }, send);
    send({ type: "ready", mode });

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as TerminalClientMessage;
        if (!isClientMessage(message)) throw new Error("Invalid terminal command");
        if (mode === "observe" && message.type !== "release") return;
        terminal.send(message);
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Invalid terminal command" });
      }
    });
    socket.on("close", () => terminal.dispose());
    socket.on("error", () => terminal.dispose());
  });

  server.on("close", () => session.close());

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
  if (message.type === "input") return typeof message.data === "string";
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
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
