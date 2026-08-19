import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneInfo, TerminalMode, TerminalServerMessage } from "../shared/protocol";
import { MobileTerminalControls } from "./MobileTerminalControls";
import { WorkingActivity } from "./WorkingActivity";
import { attachTerminalInput, type TerminalInputController } from "./terminal-input";
import { attachTerminalViewport } from "./terminal-viewport";
import { terminalThemeFor, themeFont, type ThemeId } from "./theme";

type ConnectionState = "connecting" | "connected" | "occupied" | "disconnected";

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
  const [mode, setMode] = useState<TerminalMode>("control");
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState("Connecting…");

  const disconnect = useCallback((nextMessage: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socketRef.current = undefined;
    if (modeRef.current === "control" && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "release" }));
    }
    socket.close();
    setState("disconnected");
    setMessage(nextMessage);
  }, []);

  const open = useCallback((nextMode: TerminalMode, takeover = false) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
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
        setState("connected");
        setMessage(incoming.mode === "control" ? "Control" : "Observing");
      } else if (incoming.type === "frame") {
        if (incoming.full) terminal.reset();
        terminal.write(decodeBase64(incoming.data));
      } else if (incoming.type === "occupied") {
        setState("occupied");
        setMessage("Another browser or direct attach controls this pane.");
      } else if (incoming.type === "error") {
        setMessage(incoming.message);
      } else {
        setState("disconnected");
        setMessage(incoming.reason);
      }
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      setState((current) => (current === "occupied" ? current : "disconnected"));
      setMessage((current) => (current === "Control" || current === "Observing" ? "Disconnected" : current));
    };
    socket.onerror = () => setMessage("Unable to connect to the terminal bridge");
  }, [bridgeUrl, pane.pane_id]);

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
    const releaseInBackground = () => {
      if (document.visibilityState === "hidden") disconnect("Control released while app was in background");
    };
    const releaseOnPageHide = () => disconnect("Control released while app was in background");
    document.addEventListener("visibilitychange", releaseInBackground);
    window.addEventListener("pagehide", releaseOnPageHide);
    open("control");

    return () => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "release" }));
      }
      socket?.close();
      document.removeEventListener("visibilitychange", releaseInBackground);
      window.removeEventListener("pagehide", releaseOnPageHide);
      observer.disconnect();
      detachViewport();
      input.dispose();
      inputRef.current = undefined;
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, [disconnect, open]);

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
      {state !== "connected" && (
        <div className="terminal-overlay">
          <p>{message}</p>
          <div className="overlay-actions">
            {state === "occupied" && <button onClick={() => open("observe")}>Observe</button>}
            {state === "occupied" && <button onClick={() => open("control", true)}>Control here</button>}
            {state === "disconnected" && <button onClick={() => open(mode)}>Reconnect</button>}
            <button className="secondary" onClick={onBack}>Return to panes</button>
          </div>
        </div>
      )}
    </main>
  );
}
