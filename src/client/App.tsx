import { useEffect, useRef, useState } from "react";
import type { PaneInfo, ThreadInfo } from "../shared/protocol";
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
import { groupPanesByWorkspace } from "./workspace-groups";
import { homePath, panePath, terminalRouteFromPath, threadPath, type TerminalRoute } from "./routes";

const STORAGE_KEY = "herdr-control-host";

type PaneAction = { kind: "archive" | "delete"; pane: PaneInfo; thread?: ThreadInfo };

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

function PaneActionDialog({
  action,
  error,
  pending,
  onCancel,
  onConfirm,
}: {
  action: PaneAction;
  error?: string;
  pending: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const archive = action.kind === "archive";

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="action-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <div className="action-dialog-content">
        <span className={`action-dialog-icon ${archive ? "archive" : "delete"}`} aria-hidden="true">
          {archive ? <ArchiveIcon /> : <TrashIcon />}
        </span>
        <div>
          <h2>{archive ? "Archive agent?" : "Delete pane?"}</h2>
          <p>
            {archive
              ? `${paneTitle(action.pane)} will move to Archived. Its Herdr pane will close only when the workspace can be preserved safely.`
              : `${paneTitle(action.pane)} will be removed from Control and its terminal will retire when safe.`}
          </p>
          {archive && !action.thread?.agent_session && (
            <p className="action-dialog-note">This older session has no reference, so it cannot be restored.</p>
          )}
          {error && <p className="action-dialog-error">{error}</p>}
        </div>
      </div>
      <footer>
        <button className="secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={pending} onClick={onConfirm}>
          {pending ? "Working…" : archive ? "Archive" : "Delete"}
        </button>
      </footer>
    </dialog>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 7.5h16M6 7.5V19h12V7.5M9 11h6M5 4h14v3.5H5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4.5 7h15M9 3.5h6L16 7H8l1-3.5ZM7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

export function App() {
  const [hostInput, setHostInput] = useState(initialHost);
  const [bridgeUrl, setBridgeUrl] = useState(() => normalizeHost(initialHost()));
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [terminalRoute, setTerminalRoute] = useState<TerminalRoute | undefined>(
    () => terminalRouteFromPath(window.location.pathname),
  );
  const [themeId, setThemeId] = useState(readThemePreference);
  const [paneAction, setPaneAction] = useState<PaneAction>();
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [restoringThreadId, setRestoringThreadId] = useState<string>();
  const liveSession = useLiveSession(bridgeUrl);
  const snapshot = liveSession.snapshot;
  const archivedThreads = snapshot?.threads?.filter((thread) => thread.lifecycle === "archived") ?? [];
  const archivedThreadIds = new Set(archivedThreads.map((thread) => thread.thread_id));
  const workspaceGroups = snapshot
    ? groupPanesByWorkspace(
        snapshot.workspaces,
        snapshot.panes.filter((pane) => !pane.thread_id || !archivedThreadIds.has(pane.thread_id)),
      )
    : [];
  const activePane = terminalRoute?.kind === "thread"
    ? snapshot?.panes.find((pane) => pane.thread_id === terminalRoute.id)
    : terminalRoute?.kind === "pane"
      ? snapshot?.panes.find((pane) => pane.pane_id === terminalRoute.id)
      : undefined;

  useEffect(() => {
    applyAppTheme(themeId);
    storeThemePreference(themeId);
  }, [themeId]);

  useEffect(() => {
    const followBrowserHistory = () => setTerminalRoute(terminalRouteFromPath(window.location.pathname));
    window.addEventListener("popstate", followBrowserHistory);
    return () => window.removeEventListener("popstate", followBrowserHistory);
  }, []);

  useEffect(() => {
    if (!terminalRoute || !snapshot || activePane) return;
    window.history.replaceState(null, "", homePath(window.location.search));
    setTerminalRoute(undefined);
  }, [activePane, snapshot, terminalRoute]);

  function connect() {
    const nextBridgeUrl = normalizeHost(hostInput);
    localStorage.setItem(STORAGE_KEY, nextBridgeUrl);
    setBridgeUrl(nextBridgeUrl);
    setConnectionOpen(false);
  }

  function openPane(pane: PaneInfo) {
    const route: TerminalRoute = pane.thread_id
      ? { kind: "thread", id: pane.thread_id }
      : { kind: "pane", id: pane.pane_id };
    const path = route.kind === "thread"
      ? threadPath(route.id, window.location.search)
      : panePath(route.id, window.location.search);
    window.history.pushState(null, "", path);
    setTerminalRoute(route);
  }

  function returnHome() {
    window.history.pushState(null, "", homePath(window.location.search));
    setTerminalRoute(undefined);
  }

  async function sendAction(path: string, method: "POST" | "DELETE"): Promise<void> {
    const response = await fetch(`${bridgeUrl}${path}`, { method });
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  async function confirmPaneAction() {
    if (!paneAction) return;
    setPendingAction(true);
    setActionError(undefined);
    try {
      const path = paneAction.kind === "archive"
        ? `/api/threads/${encodeURIComponent(paneAction.pane.thread_id!)}/archive`
        : `/api/panes/${encodeURIComponent(paneAction.pane.pane_id)}`;
      await sendAction(path, paneAction.kind === "archive" ? "POST" : "DELETE");
      setPaneAction(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Unable to ${paneAction.kind} pane`);
    } finally {
      setPendingAction(false);
    }
  }

  async function restoreThread(thread: ThreadInfo) {
    setRestoringThreadId(thread.thread_id);
    setActionError(undefined);
    try {
      await sendAction(`/api/threads/${encodeURIComponent(thread.thread_id)}/restore`, "POST");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to restore Thread");
    } finally {
      setRestoringThreadId(undefined);
    }
  }

  if (activePane) {
    return (
      <TerminalView
        bridgeUrl={bridgeUrl}
        pane={activePane}
        themeId={themeId}
        onBack={returnHome}
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
      {!paneAction && actionError && <p className="notice error">{actionError}</p>}

      {snapshot && (
        <section className="inventory">
          {workspaceGroups.map(({ workspace, panes }) => (
            <section className="workspace-group" key={workspace.workspace_id}>
              <h3 className="workspace-divider">{workspace.label}</h3>
              <div className="pane-list">
                {panes.map((pane) => (
                  <div className="pane-row" key={pane.pane_id}>
                    <button
                      className={`pane ${pane.agent_status === "working" ? "working" : ""}`}
                      title={pane.pane_id}
                      aria-label={`Open ${paneTitle(pane)}`}
                      onClick={() => openPane(pane)}
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
                    </button>
                    <button
                      className="pane-manage secondary icon-button"
                      type="button"
                      aria-label={`${pane.thread_id ? "Archive" : "Delete"} ${paneTitle(pane)}`}
                      title={pane.thread_id ? "Archive agent" : "Delete pane"}
                      onClick={() => {
                        setActionError(undefined);
                        setPaneAction({
                          kind: pane.thread_id ? "archive" : "delete",
                          pane,
                          thread: snapshot.threads?.find((thread) => thread.thread_id === pane.thread_id),
                        });
                      }}
                    >
                      {pane.thread_id ? <ArchiveIcon /> : <TrashIcon />}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {archivedThreads.length > 0 && (
            <section className="workspace-group archived-group">
              <h3 className="workspace-divider">Archived</h3>
              <div className="pane-list archived-list">
                {archivedThreads.map((thread) => (
                  <div className="archived-thread" key={thread.thread_id}>
                    <span className="archived-thread-icon" aria-hidden="true"><ArchiveIcon /></span>
                    <span className="archived-thread-title">{thread.title}</span>
                    {thread.agent_session && !thread.current_run && (
                      <button
                        className="secondary archived-restore"
                        type="button"
                        disabled={thread.restoring || restoringThreadId === thread.thread_id}
                        onClick={() => void restoreThread(thread)}
                      >
                        {thread.restoring || restoringThreadId === thread.thread_id ? "Restoring…" : "Restore"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>
      )}
      {paneAction && (
        <PaneActionDialog
          action={paneAction}
          error={actionError}
          pending={pendingAction}
          onCancel={() => {
            setPaneAction(undefined);
            setActionError(undefined);
          }}
          onConfirm={() => void confirmPaneAction()}
        />
      )}
    </main>
  );
}
