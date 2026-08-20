import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneInfo, TerminalMode, TerminalServerMessage } from "../shared/protocol";
import { MobileTerminalControls } from "./MobileTerminalControls";
import { WorkingActivity } from "./WorkingActivity";
import { attachTerminalInput, type TerminalInputController } from "./terminal-input";
import { attachTerminalViewport } from "./terminal-viewport";
import { terminalThemeFor, themeFont, type ThemeId } from "./theme";

type ConnectionState = "connecting" | "connected" | "occupied" | "disconnected" | "released";

interface Props {
  bridgeUrl: string;
  pane: PaneInfo;
  themeId: ThemeId;
  onBack: () => void;
}

function websocketUrl(bridgeUrl: string, paneId: string, mode: TerminalMode, takeover: boolean, terminal: Terminal) {
  const url = new URL(bridgeUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/terminal";
  url.search = new URLSearchParams({
    target: paneId,
    mode,
    takeover: String(takeover),
    cols: String(terminal.cols),
    rows: String(terminal.rows),
  }).toString();
  return url;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function TerminalView({ bridgeUrl, pane, themeId, onBack }: Props) {
  const screenRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const inputRef = useRef<TerminalInputController | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const modeRef = useRef<TerminalMode>("control");
  const openRef = useRef<(mode: TerminalMode, takeover?: boolean) => void>(() => undefined);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptRef = useRef(0);
  const wantsConnectionRef = useRef(true);
  const [mode, setMode] = useState<TerminalMode>("control");
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState("Connecting…");

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current === undefined) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = undefined;
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!wantsConnectionRef.current || document.hidden || reconnectTimerRef.current !== undefined) return;
    const delay = Math.min(250 * (2 ** reconnectAttemptRef.current), 4_000);
    reconnectAttemptRef.current += 1;
    setState("disconnected");
    setMessage("Reconnecting…");
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = undefined;
      if (wantsConnectionRef.current && !document.hidden) openRef.current(modeRef.current);
    }, delay);
  }, []);

  const disconnect = useCallback((nextMessage: string, reconnectOnFocus = false) => {
    clearReconnect();
    wantsConnectionRef.current = reconnectOnFocus;
    const socket = socketRef.current;
    socketRef.current = undefined;
    if (modeRef.current === "control" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "release" }));
    }
    socket?.close();
    setState(reconnectOnFocus ? "disconnected" : "released");
    setMessage(nextMessage);
  }, [clearReconnect]);

  const open = useCallback((nextMode: TerminalMode, takeover = false) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    clearReconnect();
    wantsConnectionRef.current = true;
    socketRef.current?.close();
    modeRef.current = nextMode;
    setMode(nextMode);
    setState("connecting");
    setMessage(nextMode === "control" ? "Acquiring control…" : "Opening observer…");

    const socket = new WebSocket(websocketUrl(bridgeUrl, pane.pane_id, nextMode, takeover, terminal));
    socketRef.current = socket;
    socket.onmessage = (event) => {
      const incoming = JSON.parse(event.data as string) as TerminalServerMessage;
      if (incoming.type === "ready") {
        reconnectAttemptRef.current = 0;
        setState("connected");
        setMessage(incoming.mode === "control" ? "Control" : "Observing");
      } else if (incoming.type === "frame") {
        if (incoming.full) terminal.reset();
        terminal.write(decodeBase64(incoming.data));
      } else if (incoming.type === "occupied") {
        socketRef.current = undefined;
        clearReconnect();
        setState("occupied");
        setMessage("Another browser or direct attach controls this pane.");
        socket.close();
      } else if (incoming.type === "error") {
        setMessage(incoming.message);
      } else {
        socket.close();
      }
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = undefined;
      scheduleReconnect();
    };
    socket.onerror = () => setMessage("Terminal connection interrupted");
  }, [bridgeUrl, clearReconnect, pane.pane_id, scheduleReconnect]);

  openRef.current = open;

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: themeFont.mono,
      fontSize: themeFont.terminalSize,
      theme: terminalThemeFor(themeId),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current!);
    terminalRef.current = terminal;
    const detachViewport = attachTerminalViewport(screenRef.current!);
    fit.fit();

    const input = attachTerminalInput({
      terminal,
      host: containerRef.current!,
      bridgeUrl,
      channel: {
        active: () => (
          modeRef.current === "control" && socketRef.current?.readyState === WebSocket.OPEN
        ),
        send: (message) => {
          const socket = socketRef.current;
          if (modeRef.current === "control" && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
          }
        },
        status: setMessage,
      },
    });
    inputRef.current = input;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current!);
    const followPageVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (wantsConnectionRef.current) disconnect("Control released while app was in background", true);
      } else if (wantsConnectionRef.current && !socketRef.current) {
        openRef.current(modeRef.current);
      }
    };
    const releaseOnPageHide = () => {
      if (wantsConnectionRef.current) disconnect("Control released while app was in background", true);
    };
    document.addEventListener("visibilitychange", followPageVisibility);
    window.addEventListener("pagehide", releaseOnPageHide);
    window.addEventListener("pageshow", followPageVisibility);
    open("control");

    return () => {
      wantsConnectionRef.current = false;
      clearReconnect();
      const socket = socketRef.current;
      socketRef.current = undefined;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "release" }));
      }
      socket?.close();
      document.removeEventListener("visibilitychange", followPageVisibility);
      window.removeEventListener("pagehide", releaseOnPageHide);
      window.removeEventListener("pageshow", followPageVisibility);
      observer.disconnect();
      detachViewport();
      input.dispose();
      inputRef.current = undefined;
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, [clearReconnect, disconnect, open]);

  useEffect(() => {
    if (pane.agent_status !== "done" || state !== "connected" || document.hidden) return;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "view" }));
  }, [pane.agent_status, state]);

  function release() {
    disconnect("Control released");
  }

  const inputActive = state === "connected" && mode === "control";
  const paneLabel = pane.terminal_title_stripped ?? pane.label ?? pane.pane_id;
  const working = pane.agent_status === "working";

  return (
    <main className="terminal-screen" ref={screenRef}>
      <header className={`terminal-header ${working ? "working" : ""}`}>
        {working && <WorkingActivity themeId={themeId} />}
        <button className="secondary icon-button terminal-home" onClick={onBack} aria-label="Home" title="Return to panes">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h5v-6h3v6h5V10" />
          </svg>
        </button>
        <div className="terminal-heading">
          <span
            className={`status ${pane.agent_status ?? "unknown"}`}
            title={pane.agent_status ?? "unknown"}
          />
          <span className="terminal-heading-copy">
            <strong>{paneLabel}</strong>
            <small>{message}</small>
          </span>
        </div>
        {state === "connected" && mode === "control" && (
          <button className="secondary terminal-action" onClick={release}>Release</button>
        )}
        {state === "connected" && mode === "observe" && (
          <button className="terminal-action primary" onClick={() => open("control", true)}>Control here</button>
        )}
        {state === "released" && (
          <button className="terminal-action primary" onClick={() => open(mode)}>Reconnect</button>
        )}
      </header>
      <div className="terminal-frame">
        <div className="terminal-host" ref={containerRef} />
      </div>
      <MobileTerminalControls
        active={inputActive}
        paneLabel={paneLabel}
        onFocusTerminal={() => inputRef.current?.focus()}
        onKey={(data) => inputRef.current?.sendKey(data) ?? false}
        onSendMessage={(text) => inputRef.current?.sendMessage(text) ?? false}
      />
      {state === "occupied" && (
        <div className="terminal-overlay">
          <p>{message}</p>
          <div className="overlay-actions">
            <button onClick={() => open("observe")}>Observe</button>
            <button onClick={() => open("control", true)}>Control here</button>
            <button className="secondary" onClick={onBack}>Return to panes</button>
          </div>
        </div>
      )}
    </main>
  );
}
