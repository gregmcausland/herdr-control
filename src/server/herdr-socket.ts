import { createConnection } from "node:net";
import type { SessionSnapshot } from "../shared/protocol.js";
import type { SessionStateConnection, SessionStateSource } from "./live-session.js";

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
let requestSequence = 0;

export class HerdrRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const LIFECYCLE_SUBSCRIPTIONS = [
  "workspace.created",
  "workspace.updated",
  "workspace.metadata_updated",
  "workspace.renamed",
  "workspace.moved",
  "workspace.reordered",
  "workspace.closed",
  "workspace.focused",
  "tab.created",
  "tab.closed",
  "tab.focused",
  "tab.renamed",
  "tab.moved",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.focused",
  "pane.moved",
  "pane.exited",
  "pane.agent_detected",
  "layout.updated",
] as const;

/** Speaks Herdr's documented newline-delimited JSON socket protocol. */
export class HerdrSocketSource implements SessionStateSource {
  constructor(private readonly socketPath: string) {}

  async connect(): Promise<SessionStateConnection> {
    // Subscribe before bootstrapping so a mutation racing the snapshot always
    // leaves a queued invalidation and causes one more authoritative read.
    const stream = await openEventStream(
      this.socketPath,
      LIFECYCLE_SUBSCRIPTIONS.map((type) => ({ type })),
    );
    try {
      const snapshot = await requestSnapshot(this.socketPath);
      return compositeConnection(this.socketPath, snapshot, stream);
    } catch (error) {
      stream.close();
      throw error;
    }
  }
}

interface EventStream {
  closed: Promise<Error | undefined>;
  subscribe(listener: () => void): () => void;
  close(): void;
}

/** Hides Herdr's pane-scoped status streams behind one invalidation interface. */
function compositeConnection(
  socketPath: string,
  snapshot: SessionSnapshot,
  primary: EventStream,
): SessionStateConnection {
  const streams = new Set<EventStream>([primary]);
  const supplemental = new Map<string, { stream: EventStream; intentional: boolean }>();
  const activePaneIds = new Set(snapshot.panes.map((pane) => pane.pane_id));
  const subscribedPaneIds = new Set<string>();
  let queued = false;
  let listener: (() => void) | undefined;
  let stopped = false;
  let resolveClosed!: (error: Error | undefined) => void;
  const closed = new Promise<Error | undefined>((resolve) => (resolveClosed = resolve));

  const terminate = (error?: Error) => {
    if (stopped) return;
    stopped = true;
    for (const stream of streams) stream.close();
    resolveClosed(error);
  };

  const invalidate = () => {
    if (stopped) return;
    if (listener) listener();
    else queued = true;
  };

  const ensurePaneSubscription = (paneId: string) => {
    if (stopped || !activePaneIds.has(paneId) || subscribedPaneIds.has(paneId)) return;
    subscribedPaneIds.add(paneId);
    void openEventStream(socketPath, [{ type: "pane.agent_status_changed", pane_id: paneId }])
      .then(async (stream) => {
        if (stopped || !activePaneIds.has(paneId)) {
          stream.close();
          subscribedPaneIds.delete(paneId);
          return;
        }
        const entry = { stream, intentional: false };
        streams.add(stream);
        supplemental.set(paneId, entry);
        const unsubscribe = stream.subscribe(invalidate);
        void stream.closed.then((error) => {
          unsubscribe();
          streams.delete(stream);
          supplemental.delete(paneId);
          subscribedPaneIds.delete(paneId);
          if (!stopped && !entry.intentional && activePaneIds.has(paneId)) {
            terminate(error ?? new Error(`Herdr status subscription closed for ${paneId}`));
          }
        });
        // Covers a status change between the snapshot and this pane-scoped
        // subscription becoming active.
        invalidate();
      })
      .catch((error) => {
        subscribedPaneIds.delete(paneId);
        if (!stopped && activePaneIds.has(paneId)) {
          terminate(error instanceof Error ? error : new Error("Unable to follow a Herdr pane"));
        }
      });
  };

  const syncPaneSubscriptions = (next: SessionSnapshot) => {
    activePaneIds.clear();
    for (const pane of next.panes) activePaneIds.add(pane.pane_id);

    for (const [paneId, entry] of supplemental) {
      if (activePaneIds.has(paneId)) continue;
      entry.intentional = true;
      entry.stream.close();
      supplemental.delete(paneId);
      subscribedPaneIds.delete(paneId);
    }
    for (const paneId of activePaneIds) ensurePaneSubscription(paneId);
  };

  const unsubscribePrimary = primary.subscribe(invalidate);
  void primary.closed.then((error) => {
    unsubscribePrimary();
    if (!stopped) terminate(error ?? new Error("Herdr lifecycle subscription closed"));
  });
  syncPaneSubscriptions(snapshot);

  return {
    snapshot,
    closed,
    async refresh() {
      const next = await requestSnapshot(socketPath);
      if (!stopped) syncPaneSubscriptions(next);
      return next;
    },
    subscribe(nextListener) {
      listener = nextListener;
      if (queued) {
        queued = false;
        nextListener();
      }
      return () => {
        if (listener === nextListener) listener = undefined;
      };
    },
    close: (error) => terminate(error),
  };
}

async function requestSnapshot(socketPath: string): Promise<SessionSnapshot> {
  const response = await requestHerdr(socketPath, "session.snapshot", {});
  const snapshot = record<SessionSnapshot>(record<Record<string, unknown>>(response.result)?.snapshot);
  if (!snapshot || !Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.tabs) || !Array.isArray(snapshot.panes)) {
    throw new Error("Herdr returned an invalid session snapshot");
  }
  return snapshot;
}

/** Performs a single documented Herdr socket action. */
export function requestHerdr(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return requestLine(socketPath, {
    id: `herdr-control:${method}:${Date.now()}:${++requestSequence}`,
    method,
    params,
  });
}

async function openEventStream(
  socketPath: string,
  subscriptions: Array<Record<string, unknown>>,
): Promise<EventStream> {
  const requestId = `herdr-control:events:${Date.now()}:${++requestSequence}`;
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  let buffer = "";
  let listener: (() => void) | undefined;
  let queued = false;
  let closeError: Error | undefined;
  let acknowledged = false;

  let resolveClosed!: (error: Error | undefined) => void;
  const closed = new Promise<Error | undefined>((resolve) => (resolveClosed = resolve));
  let resolveAck!: () => void;
  let rejectAck!: (error: Error) => void;
  const ack = new Promise<void>((resolve, reject) => {
    resolveAck = resolve;
    rejectAck = reject;
  });

  socket.on("connect", () => {
    socket.write(`${JSON.stringify({
      id: requestId,
      method: "events.subscribe",
      params: { subscriptions },
    })}\n`);
  });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      closeError = new Error("Herdr event record exceeded the size limit");
      socket.destroy(closeError);
      return;
    }

    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (!acknowledged) {
          if (value.id !== requestId || record(value.error)) {
            throw new Error(messageFromResponse(value, "Herdr rejected the event subscription"));
          }
          acknowledged = true;
          resolveAck();
          continue;
        }
        const event = string(value.event);
        const data = record<Record<string, unknown>>(value.data);
        if (!event || !data) throw new Error("Herdr emitted an invalid session event");
        if (listener) listener();
        else queued = true;
      } catch (error) {
        closeError = error instanceof Error ? error : new Error("Unable to read Herdr event");
        socket.destroy(closeError);
      }
    }
  });
  socket.on("error", (error) => {
    closeError ??= error;
    if (!acknowledged) rejectAck(error);
  });
  socket.on("close", () => {
    if (!acknowledged) rejectAck(closeError ?? new Error("Herdr event subscription closed before acknowledgement"));
    resolveClosed(closeError);
  });

  const timer = setTimeout(() => {
    closeError = new Error("Timed out subscribing to Herdr events");
    socket.destroy(closeError);
  }, REQUEST_TIMEOUT_MS);
  timer.unref();
  try {
    await ack;
  } finally {
    clearTimeout(timer);
  }

  return {
    close: () => socket.destroy(),
    closed,
    subscribe(nextListener) {
      listener = nextListener;
      if (queued) {
        queued = false;
        nextListener();
      }
      return () => {
        if (listener === nextListener) listener = undefined;
      };
    },
  };
}

function requestLine(socketPath: string, request: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Timed out waiting for Herdr")), REQUEST_TIMEOUT_MS);
    timer.unref();

    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };

    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        finish(new Error("Herdr response exceeded the size limit"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const value = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
        const responseError = record<Record<string, unknown>>(value.error);
        if (responseError) {
          finish(new HerdrRequestError(
            string(responseError.code) ?? "herdr_request_failed",
            string(responseError.message) ?? "Herdr request failed",
          ));
        } else finish(undefined, value);
      } catch {
        finish(new Error("Herdr returned invalid JSON"));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled) finish(new Error("Herdr closed the socket without a response"));
    });
  });
}

function messageFromResponse(value: Record<string, unknown>, fallback: string): string {
  const error = record<Record<string, unknown>>(value.error);
  return string(error?.message) ?? fallback;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function record<T extends object = Record<string, unknown>>(value: unknown): T | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}
