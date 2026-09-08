import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalServerMessage } from "../shared/protocol";
import { createTerminalSession, type TerminalSessionState } from "./terminal-session";

class FakeSocket {
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: object[] = [];

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
  }

  receive(message: TerminalServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const states: TerminalSessionState[] = [];
  const frames: TerminalServerMessage[] = [];
  const session = createTerminalSession({
    url: (mode, takeover) => `ws://terminal?mode=${mode}&takeover=${takeover}`,
    onState: (state) => states.push(state),
    onFrame: (frame) => frames.push(frame),
  }, {
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { session, sockets, states, frames };
}

describe("terminal session ownership", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for release acknowledgement before reacquiring after resume", () => {
    const { session, sockets } = setup();
    session.connect("control");
    sockets[0].receive({ type: "ready", mode: "control" });

    session.suspend();
    session.resume();
    session.resume();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toContainEqual({ type: "release" });
    expect(session.getState().phase).toBe("releasing");

    sockets[0].receive({ type: "released" });

    expect(sockets).toHaveLength(2);
    expect(session.getState().phase).toBe("connecting");
  });

  it("falls back safely when an older bridge cannot acknowledge release", () => {
    const { session, sockets } = setup();
    session.connect("control");
    sockets[0].receive({ type: "ready", mode: "control" });

    session.suspend();
    session.resume();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(session.getState().phase).toBe("connecting");
  });

  it("ignores messages from a superseded socket", () => {
    const { session, sockets, frames } = setup();
    session.connect("control");
    const staleMessage = sockets[0].onmessage!;
    sockets[0].receive({ type: "ready", mode: "control" });
    session.suspend();
    session.resume();
    sockets[0].receive({ type: "released" });
    sockets[1].receive({ type: "ready", mode: "control" });

    staleMessage({ data: JSON.stringify({ type: "occupied", message: "stale" }) });
    staleMessage({ data: JSON.stringify({ type: "frame", seq: 1, cols: 80, rows: 24, full: true, data: "" }) });

    expect(session.getState()).toMatchObject({ phase: "connected", message: "Control" });
    expect(frames).toEqual([]);
  });

  it("recovers when reacquisition briefly collides with the old owner", () => {
    const { session, sockets } = setup();
    session.connect("control");
    sockets[0].receive({ type: "occupied", message: "still attached" });

    expect(session.getState()).toMatchObject({ phase: "disconnected", message: "Waiting for control…" });
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    sockets[1].receive({ type: "ready", mode: "control" });

    expect(session.getState()).toMatchObject({ phase: "connected", message: "Control" });
  });

  it("shows real contention after bounded non-takeover retries", () => {
    const { session, sockets } = setup();
    session.connect("control");

    for (const delay of [100, 250, 500, 1_000]) {
      sockets.at(-1)!.receive({ type: "occupied", message: "still attached" });
      vi.advanceTimersByTime(delay);
    }
    sockets.at(-1)!.receive({ type: "occupied", message: "still attached" });

    expect(sockets).toHaveLength(5);
    expect(session.getState()).toMatchObject({
      phase: "occupied",
      message: "Another browser or direct attach controls this pane.",
    });
  });

  it("keeps takeover explicit and does not retry it automatically", () => {
    const { session, sockets } = setup();
    session.connect("control", true);
    sockets[0].receive({ type: "occupied", message: "takeover failed" });
    vi.runAllTimers();

    expect(sockets).toHaveLength(1);
    expect(session.getState().phase).toBe("occupied");
  });
  it("replaces an apparently open connection that stops answering health checks", () => {
    const { session, sockets } = setup();
    session.connect("control");
    sockets[0].receive({ type: "ready", mode: "control" });
    vi.advanceTimersByTime(10_000);
    expect(sockets[0].sent).toContainEqual({ type: "ping" });
    vi.advanceTimersByTime(5_250);
    expect(sockets).toHaveLength(2);
    session.dispose();
  });

  it("keeps a server compatibility failure local to the terminal", () => {
    const { session, sockets } = setup();
    session.connect("control");
    sockets[0].receive({
      type: "closed",
      reason: "Herdr client protocol 22 does not match server protocol 20",
    });

    expect(session.getState()).toMatchObject({
      phase: "disconnected",
      message: "Herdr client protocol 22 does not match server protocol 20",
    });
    vi.advanceTimersByTime(250);
    expect(sockets).toHaveLength(2);
  });

  it("keeps a healthy observer connected without requiring control", () => {
    const { session, sockets } = setup();
    session.connect("observe");
    sockets[0].receive({ type: "ready", mode: "observe" });
    vi.advanceTimersByTime(10_000);
    sockets[0].receive({ type: "pong" });
    vi.advanceTimersByTime(5_001);
    expect(sockets).toHaveLength(1);
    expect(session.getState().phase).toBe("connected");
    session.dispose();
  });

});
