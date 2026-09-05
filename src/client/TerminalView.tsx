import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { PaneInfo, TerminalMode } from "../shared/protocol";
import { MobileTerminalControls } from "./MobileTerminalControls";
import { WorkingActivity } from "./WorkingActivity";
import { createTerminalColorAdapter, type TerminalColorAdapter } from "./terminal-color-adapter";
import { attachTerminalInput, type TerminalInputController } from "./terminal-input";
import { createTerminalLinkInteractions } from "./terminal-links";
import { createTerminalSession, type TerminalSession, type TerminalSessionState } from "./terminal-session";
import { attachTerminalViewport } from "./terminal-viewport";
import { terminalMinimumContrastRatio, terminalThemeFor, type ThemeId } from "./theme";

interface Props {
  bridgeUrl: string;
  pane: PaneInfo;
  themeId: ThemeId;
  fontFamily: string;
  fontSize: number;
  cursorBlink: boolean;
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
  return url.toString();
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function TerminalView({ bridgeUrl, pane, themeId, fontFamily, fontSize, cursorBlink, onBack }: Props) {
  const screenRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const inputRef = useRef<TerminalInputController | undefined>(undefined);
  const colorAdapterRef = useRef<TerminalColorAdapter | undefined>(undefined);
  const sessionRef = useRef<TerminalSession | undefined>(undefined);
  const [sessionState, setSessionState] = useState<TerminalSessionState>({
    phase: "connecting",
    mode: "control",
    message: "Connecting…",
  });

  useEffect(() => {
    let terminal!: Terminal;
    const links = createTerminalLinkInteractions(() => terminal.element ?? undefined);
    terminal = new Terminal({
      cursorBlink,
      convertEol: false,
      fontFamily,
      fontSize,
      linkHandler: {
        activate: links.activate,
        hover: links.hover,
        leave: links.leave,
        allowNonHttpProtocols: false,
      },
      minimumContrastRatio: terminalMinimumContrastRatio(themeId),
      theme: terminalThemeFor(themeId),
    });
    colorAdapterRef.current = createTerminalColorAdapter(themeId);
    const fit = new FitAddon();
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon(links.activate, {
      hover: links.hover,
      leave: links.leave,
    }));
    terminal.open(containerRef.current!);
    terminalRef.current = terminal;
    const detachViewport = attachTerminalViewport(screenRef.current!);
    fit.fit();

    const session = createTerminalSession({
      url: (mode, takeover) => websocketUrl(bridgeUrl, pane.pane_id, mode, takeover, terminal),
      onState: setSessionState,
      onFrame: (frame) => {
        if (frame.full) {
          terminal.reset();
          colorAdapterRef.current?.reset();
        }
        const data = decodeBase64(frame.data);
        terminal.write(colorAdapterRef.current?.transform(data) ?? data);
      },
    });
    sessionRef.current = session;

    const input = attachTerminalInput({
      terminal,
      host: containerRef.current!,
      bridgeUrl,
      channel: {
        active: () => sessionRef.current?.isControlling() ?? false,
        send: (message) => { sessionRef.current?.send(message); },
        status: (message) => setSessionState((current) => ({ ...current, message })),
      },
    });
    inputRef.current = input;

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fit.fit(), 120);
    });
    observer.observe(containerRef.current!);
    const followPageVisibility = () => {
      if (document.visibilityState === "hidden") session.suspend();
      else session.resume();
    };
    const releaseOnPageHide = () => session.suspend();
    const reconnectWhenActive = () => {
      if (!document.hidden) session.resume();
    };
    document.addEventListener("visibilitychange", followPageVisibility);
    document.addEventListener("freeze", releaseOnPageHide);
    document.addEventListener("resume", reconnectWhenActive);
    window.addEventListener("pagehide", releaseOnPageHide);
    window.addEventListener("pageshow", reconnectWhenActive);
    window.addEventListener("focus", reconnectWhenActive);
    window.addEventListener("online", reconnectWhenActive);
    session.connect("control");

    return () => {
      session.dispose();
      sessionRef.current = undefined;
      document.removeEventListener("visibilitychange", followPageVisibility);
      document.removeEventListener("freeze", releaseOnPageHide);
      document.removeEventListener("resume", reconnectWhenActive);
      window.removeEventListener("pagehide", releaseOnPageHide);
      window.removeEventListener("pageshow", reconnectWhenActive);
      window.removeEventListener("focus", reconnectWhenActive);
      window.removeEventListener("online", reconnectWhenActive);
      observer.disconnect();
      clearTimeout(resizeTimer);
      detachViewport();
      input.dispose();
      inputRef.current = undefined;
      fitRef.current = undefined;
      colorAdapterRef.current = undefined;
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, [bridgeUrl, pane.pane_id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.cursorBlink = cursorBlink;
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontSize = fontSize;
    terminal.options.minimumContrastRatio = terminalMinimumContrastRatio(themeId);
    terminal.options.theme = terminalThemeFor(themeId);
    colorAdapterRef.current = createTerminalColorAdapter(themeId);
    fitRef.current?.fit();
  }, [cursorBlink, fontFamily, fontSize, themeId]);

  const inputActive = sessionState.phase === "connected" && sessionState.mode === "control";
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
            <small>{sessionState.message}</small>
          </span>
        </div>
        {sessionState.phase === "connected" && sessionState.mode === "control" && (
          <button className="secondary terminal-action" onClick={() => sessionRef.current?.release()}>Release</button>
        )}
        {sessionState.phase === "connected" && sessionState.mode === "observe" && (
          <button className="terminal-action primary" onClick={() => sessionRef.current?.connect("control", true)}>Control here</button>
        )}
        {(sessionState.phase === "released" || sessionState.phase === "disconnected") && (
          <button className="terminal-action primary" onClick={() => sessionRef.current?.connect(sessionState.mode)}>Reconnect</button>
        )}
      </header>
      <div className="terminal-frame">
        <div className="terminal-host" ref={containerRef} />
      </div>
      <MobileTerminalControls
        terminalActive={inputActive}
        paneLabel={paneLabel}
        onFocusTerminal={() => inputRef.current?.focus()}
        onKey={(data) => inputRef.current?.sendKey(data) ?? false}

      />
      {sessionState.phase === "occupied" && (
        <div className="terminal-overlay">
          <p>{sessionState.message}</p>
          <div className="overlay-actions">
            <button onClick={() => sessionRef.current?.connect("observe")}>Observe</button>
            <button onClick={() => sessionRef.current?.connect("control", true)}>Control here</button>
            <button className="secondary" onClick={onBack}>Return to panes</button>
          </div>
        </div>
      )}
    </main>
  );
}
