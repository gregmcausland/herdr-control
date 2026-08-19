import { useMemo, useState } from "react";
import type { PaneInfo } from "../shared/protocol";
import { TerminalView } from "./TerminalView";
import { useLiveSession } from "./live-session";

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

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

export function App() {
  const [hostInput, setHostInput] = useState(initialHost);
  const [bridgeUrl, setBridgeUrl] = useState(() => normalizeHost(initialHost()));
  const [selectedPane, setSelectedPane] = useState<PaneInfo>();
  const liveSession = useLiveSession(bridgeUrl);
  const snapshot = liveSession.snapshot;

  function connect() {
    const nextBridgeUrl = normalizeHost(hostInput);
    localStorage.setItem(STORAGE_KEY, nextBridgeUrl);
    setBridgeUrl(nextBridgeUrl);
    setSelectedPane(undefined);
  }

  const tabsByWorkspace = useMemo(
    () => groupBy(snapshot?.tabs ?? [], (tab) => tab.workspace_id),
    [snapshot],
  );
  const panesByTab = useMemo(() => groupBy(snapshot?.panes ?? [], (pane) => pane.tab_id), [snapshot]);

  if (selectedPane) {
    return (
      <TerminalView
        bridgeUrl={bridgeUrl}
        pane={selectedPane}
        onBack={() => setSelectedPane(undefined)}
      />
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Remote terminal control</p>
          <h1>Herdr Control</h1>
        </div>
        <span className={`connection-status ${liveSession.status}`}>
          {liveSession.status === "live" ? "Live" : liveSession.status === "stale" ? "Reconnecting" : "Connecting"}
        </span>
      </header>

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

      {liveSession.status === "connecting" && <p className="notice">Connecting to {bridgeUrl}…</p>}
      {liveSession.status === "stale" && (
        <p className={`notice ${snapshot ? "" : "error"}`}>
          {snapshot ? "Showing the last known state. " : ""}{liveSession.message ?? "Unable to connect to bridge"}
        </p>
      )}

      {snapshot && (
        <section className="inventory">
          <div className="inventory-heading">
            <h2>Workspaces</h2>
            <span>Herdr {snapshot.version}</span>
          </div>
          {snapshot.workspaces.map((workspace) => (
            <article className="workspace" key={workspace.workspace_id}>
              <header>
                <div>
                  <h3>{workspace.label}</h3>
                  <code>{workspace.workspace_id}</code>
                </div>
                <span>{workspace.pane_count} panes</span>
              </header>
              {(tabsByWorkspace.get(workspace.workspace_id) ?? []).map((tab) => (
                <div className="tab" key={tab.tab_id}>
                  <div className="tab-label">
                    <strong>Tab {tab.number}: {tab.label}</strong>
                    <code>{tab.tab_id}</code>
                  </div>
                  <div className="pane-list">
                    {(panesByTab.get(tab.tab_id) ?? []).map((pane) => (
                      <button className="pane" key={pane.pane_id} onClick={() => setSelectedPane(pane)}>
                        <span className={`status ${pane.agent_status ?? "unknown"}`} />
                        <span className="pane-copy">
                          <strong>{pane.terminal_title_stripped ?? pane.label ?? pane.agent ?? pane.pane_id}</strong>
                          <small>{pane.agent ? `${pane.agent} · ${pane.agent_status}` : pane.foreground_cwd ?? pane.cwd}</small>
                        </span>
                        <code>{pane.pane_id}</code>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
