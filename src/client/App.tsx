import { useEffect, useState } from "react";
import type { PaneInfo } from "../shared/protocol";
import { TerminalView } from "./TerminalView";
import { useLiveSession } from "./live-session";
import {
  applyAppTheme,
  isThemeId,
  readThemePreference,
  storeThemePreference,
  themeLabel,
  themeOptions,
} from "./theme";
import { WorkingActivity } from "./WorkingActivity";

const STORAGE_KEY = "herdr-control-host";

function initialHost(): string {
  const query = new URLSearchParams(window.location.search).get("host");
  return query ?? localStorage.getItem(STORAGE_KEY) ?? window.location.origin;
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function paneTitle(pane: PaneInfo): string {
  return pane.terminal_title_stripped ?? pane.label ?? pane.display_agent ?? pane.agent ?? pane.pane_id;
}

function paneDetail(pane: PaneInfo): string {
  if (pane.agent) {
    const agent = pane.display_agent ?? pane.agent;
    const status = pane.agent_status ?? "unknown";
    return `${agent.charAt(0).toUpperCase()}${agent.slice(1)} · ${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  }
  const path = pane.foreground_cwd ?? pane.cwd;
  if (!path) return "Shell";
  const segments = path.split("/").filter(Boolean);
  return segments.length > 2 ? `…/${segments.slice(-2).join("/")}` : path;
}

export function App() {
  const [hostInput, setHostInput] = useState(initialHost);
  const [bridgeUrl, setBridgeUrl] = useState(() => normalizeHost(initialHost()));
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [selectedPane, setSelectedPane] = useState<PaneInfo>();
  const [themeId, setThemeId] = useState(readThemePreference);
  const liveSession = useLiveSession(bridgeUrl);
  const snapshot = liveSession.snapshot;
  const activePane = selectedPane
    ? snapshot?.panes.find((pane) => pane.pane_id === selectedPane.pane_id) ?? selectedPane
    : undefined;

  useEffect(() => {
    applyAppTheme(themeId);
    storeThemePreference(themeId);
  }, [themeId]);

  function connect() {
    const nextBridgeUrl = normalizeHost(hostInput);
    localStorage.setItem(STORAGE_KEY, nextBridgeUrl);
    setBridgeUrl(nextBridgeUrl);
    setConnectionOpen(false);
    setSelectedPane(undefined);
  }

  if (activePane) {
    return (
      <TerminalView
        bridgeUrl={bridgeUrl}
        pane={activePane}
        themeId={themeId}
        onBack={() => setSelectedPane(undefined)}
      />
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Herdr Control</h1>
        <div className="masthead-actions">
          {snapshot && (
            <span className="herdr-version"><span className="herdr-version-prefix">Herdr </span>{snapshot.version}</span>
          )}
          <span className={`connection-status ${liveSession.status}`}>
            {liveSession.status === "live" ? "Live" : liveSession.status === "stale" ? "Reconnecting" : "Connecting"}
          </span>
          <label className="theme-picker" title={`Theme: ${themeLabel(themeId)}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 0-3.6h-.7a1.6 1.6 0 0 1 0-3.2H15A6 6 0 0 0 21 8.3C19.4 5.1 16 3 12 3Z" />
              <circle cx="7.5" cy="10" r=".8" />
              <circle cx="10" cy="6.8" r=".8" />
              <circle cx="14" cy="6.5" r=".8" />
              <circle cx="17.2" cy="9" r=".8" />
            </svg>
            <span className="theme-picker-label">{themeLabel(themeId)}</span>
            <span className="theme-picker-chevron" aria-hidden="true">⌄</span>
            <select
              aria-label="Theme"
              value={themeId}
              onChange={(event) => {
                if (isThemeId(event.target.value)) setThemeId(event.target.value);
              }}
            >
              {themeOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary connection-trigger"
            type="button"
            aria-expanded={connectionOpen}
            onClick={() => setConnectionOpen((open) => !open)}
          >
            Connection
          </button>
        </div>
      </header>

      {connectionOpen && (
        <form
          className="connection"
          onSubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <label htmlFor="bridge-host">Herdr bridge</label>
          <div className="connection-row">
            <input
              id="bridge-host"
              value={hostInput}
              onChange={(event) => setHostInput(event.target.value)}
              placeholder="https://servermz.example.ts.net"
              inputMode="url"
            />
            <button type="submit">Connect</button>
          </div>
        </form>
      )}

      {liveSession.status === "connecting" && <p className="notice">Connecting to {bridgeUrl}…</p>}
      {liveSession.status === "stale" && (
        <p className={`notice ${snapshot ? "" : "error"}`}>
          {snapshot ? "Showing the last known state. " : ""}{liveSession.message ?? "Unable to connect to bridge"}
        </p>
      )}

      {snapshot && (
        <section className="inventory">
          {snapshot.workspaces.map((workspace) => {
            const panes = snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id);
            if (panes.length === 0) return null;

            return (
              <section className="workspace-group" key={workspace.workspace_id}>
                <h3 className="workspace-divider">{workspace.label}</h3>
                <div className="pane-list">
                  {panes.map((pane) => (
                    <button
                      className={`pane ${pane.agent_status === "working" ? "working" : ""}`}
                      key={pane.pane_id}
                      title={pane.pane_id}
                      aria-label={`Open ${paneTitle(pane)}`}
                      onClick={() => setSelectedPane(pane)}
                    >
                      {pane.agent_status === "working" && <WorkingActivity themeId={themeId} />}
                      <span
                        className={`status ${pane.agent_status ?? "unknown"}`}
                        title={pane.agent_status ?? "unknown"}
                      />
                      <span className="pane-copy">
                        <strong>{paneTitle(pane)}</strong>
                        <small>{paneDetail(pane)}</small>
                      </span>
                      <span className="pane-action" aria-hidden="true">Open</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      )}
    </main>
  );
}
