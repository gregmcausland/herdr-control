import type { TerminalClientMessage, TerminalMode, TerminalServerMessage } from "../shared/protocol";

const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const ACQUISITION_TIMEOUT_MS = 8_000;
const RELEASE_TIMEOUT_MS = 1_000;
const OCCUPIED_RETRY_DELAYS_MS = [100, 250, 500, 1_000] as const;

export type TerminalSessionPhase =
  | "connecting"
  | "connected"
  | "releasing"
  | "occupied"
  | "disconnected"
  | "released";

export interface TerminalSessionState {
  phase: TerminalSessionPhase;
  mode: TerminalMode;
  message: string;
}

type TerminalFrame = Extract<TerminalServerMessage, { type: "frame" }>;

interface SessionSocket {
  readonly readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

interface TerminalSessionDependencies {
  openSocket(url: string): SessionSocket;
}

interface TerminalSessionOptions {
  url: (mode: TerminalMode, takeover: boolean) => string;
  onState: (state: TerminalSessionState) => void;
  onFrame: (frame: TerminalFrame) => void;
}

interface Attempt {
  generation: number;
  mode: TerminalMode;
  takeover: boolean;
  socket: SessionSocket;
  phase: "connecting" | "connected" | "releasing";
  acquisitionTimer?: ReturnType<typeof setTimeout>;
  releaseTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  healthTimer?: ReturnType<typeof setTimeout>;
}

export interface TerminalSession {
  connect(mode: TerminalMode, takeover?: boolean): void;
  resume(): void;
  suspend(): void;
  release(): void;
  send(message: TerminalClientMessage): boolean;
  isControlling(): boolean;
  getState(): TerminalSessionState;
  dispose(): void;
}

/** Owns one terminal's connection, release handshake, retries, and stale-attempt rejection. */
export function createTerminalSession(
  options: TerminalSessionOptions,
  dependencies: TerminalSessionDependencies = { openSocket: (url) => new WebSocket(url) as unknown as SessionSocket },
): TerminalSession {
  let state: TerminalSessionState = { phase: "released", mode: "control", message: "Control released" };
  let preferredMode: TerminalMode = "control";
  let desiredMode: TerminalMode | undefined;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  let attempt: Attempt | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let occupiedAttempt = 0;
  let pendingTakeover = false;

  const publish = (next: TerminalSessionState) => {
    if (state.phase === next.phase && state.mode === next.mode && state.message === next.message) return;
    state = next;
    options.onState(next);
  };

  const clearRetry = () => {
    if (retryTimer === undefined) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const clearAttemptTimers = (current: Attempt) => {
    if (current.acquisitionTimer !== undefined) clearTimeout(current.acquisitionTimer);
    if (current.releaseTimer !== undefined) clearTimeout(current.releaseTimer);
    if (current.heartbeatTimer !== undefined) clearInterval(current.heartbeatTimer);
    if (current.healthTimer !== undefined) clearTimeout(current.healthTimer);
    current.acquisitionTimer = undefined;
    current.releaseTimer = undefined;
    current.heartbeatTimer = undefined;
    current.healthTimer = undefined;
  };

  const closeAttempt = (current: Attempt) => {
    if (attempt !== current) return;
    attempt = undefined;
    clearAttemptTimers(current);
    current.socket.onmessage = null;
    current.socket.onclose = null;
    current.socket.onerror = null;
    if (current.socket.readyState < SOCKET_CLOSING) current.socket.close();
  };

  const retryConnection = (delay: number, message = "Reconnecting…") => {
    if (disposed || suspended || !desiredMode || retryTimer !== undefined) return;
    publish({ phase: "disconnected", mode: desiredMode, message });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      reconcile();
    }, delay);
  };

  const retryAfterClose = (message?: string) => {
    const delay = Math.min(250 * (2 ** reconnectAttempt), 4_000);
    reconnectAttempt += 1;
    retryConnection(delay, message);
  };

  const finishAttempt = (current: Attempt) => {
    closeAttempt(current);
    reconcile();
  };

  const handleOccupied = (current: Attempt) => {
    const takeover = current.takeover;
    closeAttempt(current);
    if (!disposed && !suspended && desiredMode && !takeover && occupiedAttempt < OCCUPIED_RETRY_DELAYS_MS.length) {
      const delay = OCCUPIED_RETRY_DELAYS_MS[occupiedAttempt];
      occupiedAttempt += 1;
      retryConnection(delay, "Waiting for control…");
      return;
    }
    publish({
      phase: "occupied",
      mode: desiredMode ?? preferredMode,
      message: "Another browser or direct attach controls this pane.",
    });
  };

  const openDesired = () => {
    if (disposed || suspended || !desiredMode || attempt || retryTimer !== undefined) return;
    const mode = desiredMode;
    const takeover = pendingTakeover;
    pendingTakeover = false;
    publish({
      phase: "connecting",
      mode,
      message: mode === "control" ? "Acquiring control…" : "Opening observer…",
    });

    let socket: SessionSocket;
    try {
      socket = dependencies.openSocket(options.url(mode, takeover));
    } catch {
      retryAfterClose();
      return;
    }

    const current: Attempt = {
      generation: ++generation,
      mode,
      takeover,
      socket,
      phase: "connecting",
    };
    attempt = current;
    current.acquisitionTimer = setTimeout(() => {
      if (attempt !== current || current.phase !== "connecting") return;
      closeAttempt(current);
      retryAfterClose();
    }, ACQUISITION_TIMEOUT_MS);

    socket.onmessage = (event) => {
      if (attempt !== current || current.generation !== generation) return;
      let incoming: TerminalServerMessage;
      try {
        incoming = JSON.parse(event.data) as TerminalServerMessage;
      } catch {
        closeAttempt(current);
        retryAfterClose();
        return;
      }

      if (incoming.type === "ready") {
        if (incoming.mode !== current.mode || current.phase === "releasing") return;
        if (current.acquisitionTimer !== undefined) clearTimeout(current.acquisitionTimer);
        current.acquisitionTimer = undefined;
        current.phase = "connected";
        current.heartbeatTimer = setInterval(() => {
          if (attempt !== current || current.phase !== "connected" || current.healthTimer !== undefined) return;
          current.socket.send(JSON.stringify({ type: "ping" }));
          current.healthTimer = setTimeout(() => {
            if (attempt !== current || current.phase !== "connected") return;
            closeAttempt(current);
            retryAfterClose();
          }, 5_000);
        }, 10_000);
        reconnectAttempt = 0;
        occupiedAttempt = 0;
        publish({
          phase: "connected",
          mode: current.mode,
          message: current.mode === "control" ? "Control" : "Observing",
        });
      } else if (incoming.type === "pong") {
        if (current.healthTimer !== undefined) clearTimeout(current.healthTimer);
        current.healthTimer = undefined;
      } else if (incoming.type === "frame") {
        if (current.phase === "connected") options.onFrame(incoming);
      } else if (incoming.type === "released") {
        finishAttempt(current);
      } else if (incoming.type === "occupied") {
        handleOccupied(current);
      } else if (incoming.type === "error") {
        publish({ phase: state.phase, mode: current.mode, message: incoming.message });
      } else {
        closeAttempt(current);
        retryAfterClose(incoming.reason);
      }
    };
    socket.onclose = () => {
      if (attempt !== current) return;
      const wasReleasing = current.phase === "releasing";
      closeAttempt(current);
      if (wasReleasing) reconcile();
      else retryAfterClose();
    };
    socket.onerror = () => {
      if (attempt !== current) return;
      closeAttempt(current);
      retryAfterClose();
    };
  };

  function reconcile() {
    if (disposed || attempt || retryTimer !== undefined) return;
    if (suspended) {
      publish({
        phase: "disconnected",
        mode: desiredMode ?? preferredMode,
        message: "Control released while app was in background",
      });
    } else if (!desiredMode) {
      publish({ phase: "released", mode: preferredMode, message: "Control released" });
    } else {
      openDesired();
    }
  }

  const beginRelease = () => {
    clearRetry();
    const current = attempt;
    if (!current) {
      reconcile();
      return;
    }
    if (current.phase === "releasing") return;
    if (current.acquisitionTimer !== undefined) clearTimeout(current.acquisitionTimer);
    current.acquisitionTimer = undefined;

    if (current.socket.readyState !== SOCKET_OPEN) {
      finishAttempt(current);
      return;
    }

    clearAttemptTimers(current);
    current.phase = "releasing";
    publish({ phase: "releasing", mode: current.mode, message: "Releasing control…" });
    current.socket.send(JSON.stringify({ type: "release" }));
    current.releaseTimer = setTimeout(() => finishAttempt(current), RELEASE_TIMEOUT_MS);
  };

  return {
    connect(mode, takeover = false) {
      if (disposed) return;
      preferredMode = mode;
      desiredMode = mode;
      suspended = false;
      pendingTakeover = takeover;
      occupiedAttempt = 0;
      clearRetry();
      if (attempt) beginRelease();
      else reconcile();
    },

    resume() {
      if (disposed || !desiredMode) return;
      suspended = false;
      clearRetry();
      if (attempt?.phase === "connected") beginRelease();
      else if (!attempt) reconcile();
    },

    suspend() {
      if (disposed || !desiredMode) return;
      suspended = true;
      clearRetry();
      beginRelease();
    },

    release() {
      if (disposed) return;
      desiredMode = undefined;
      suspended = false;
      pendingTakeover = false;
      clearRetry();
      beginRelease();
    },

    send(message) {
      const current = attempt;
      if (
        !current ||
        current.phase !== "connected" ||
        current.socket.readyState !== SOCKET_OPEN ||
        (message.type !== "ping" && current.mode !== "control")
      ) return false;
      current.socket.send(JSON.stringify(message));
      return true;
    },

    isControlling() {
      return attempt?.phase === "connected" && attempt.mode === "control" && attempt.socket.readyState === SOCKET_OPEN;
    },

    getState: () => state,

    dispose() {
      if (disposed) return;
      disposed = true;
      desiredMode = undefined;
      clearRetry();
      const current = attempt;
      if (!current) return;
      if (current.socket.readyState === SOCKET_OPEN) current.socket.send(JSON.stringify({ type: "release" }));
      closeAttempt(current);
    },
  };
}
