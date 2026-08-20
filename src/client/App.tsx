import { useEffect, useRef, useState } from "react";
import type { PaneInfo, ProjectInfo, ThreadCreationRequest, ThreadInfo } from "../shared/protocol";
import { TerminalView } from "./TerminalView";
import { PlusIcon, ThreadCreationDialog } from "./ThreadCreationDialog";
import { SettingsDialog, SettingsIcon } from "./SettingsDialog";
import { applyFontSettings, readAppSettings, storeAppSettings } from "./settings";
import { useLiveSession } from "./live-session";
import { applyAppTheme } from "./theme";
import { WorkingActivity } from "./WorkingActivity";
import { groupPanesByProject } from "./workspace-groups";
import { homePath, panePath, terminalRouteFromPath, threadPath, type TerminalRoute } from "./routes";
import { workingDuration } from "./working-duration";

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
  return pane.label ?? pane.terminal_title_stripped ?? pane.display_agent ?? pane.agent ?? pane.pane_id;
}

function paneDetail(pane: PaneInfo, now: number): string {
  if (pane.agent) {
    const agent = pane.display_agent ?? pane.agent;
    const status = pane.agent_status ?? "unknown";
    const duration = workingDuration(pane, now);
    return [
      `${agent.charAt(0).toUpperCase()}${agent.slice(1)}`,
      `${status.charAt(0).toUpperCase()}${status.slice(1)}`,
      duration,
    ].filter(Boolean).join(" · ");
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
          <h2>{archive ? "Archive thread?" : action.thread ? "Delete thread?" : "Delete pane?"}</h2>
          <p>
            {archive
              ? `${paneTitle(action.pane)} will leave the active view and can be restored later. Its terminal will retire when safe.`
              : action.thread
                ? `${paneTitle(action.pane)} has no resumable session yet. It will be permanently removed from Control and its terminal will retire when safe.`
                : `${paneTitle(action.pane)} will be removed from Control and its terminal will retire when safe.`}
          </p>
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

function WorktreeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <path d="M4 4.5v7M5.5 8h1.75A4.75 4.75 0 0 0 12 6.5" />
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
  const [settings, setSettings] = useState(readAppSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paneAction, setPaneAction] = useState<PaneAction>();
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [restoringThreadId, setRestoringThreadId] = useState<string>();
  const [creationProject, setCreationProject] = useState<ProjectInfo>();
  const [creationPending, setCreationPending] = useState(false);
  const [creationError, setCreationError] = useState<string>();
  const [clock, setClock] = useState(Date.now);
  const liveSession = useLiveSession(bridgeUrl);
  const snapshot = liveSession.snapshot;
  const archivedThreads = snapshot?.threads?.filter(
    (thread) => thread.lifecycle === "archived" && thread.agent_session,
  ) ?? [];
  const archivedThreadIds = new Set(archivedThreads.map((thread) => thread.thread_id));
  const linkedWorktreeIds = new Set(
    snapshot?.worktrees?.filter((worktree) => worktree.is_linked_worktree).map((worktree) => worktree.worktree_id),
  );
  const projectGroups = snapshot
    ? groupPanesByProject(
        snapshot.projects ?? [],
        snapshot.worktrees ?? [],
        snapshot.workspaces,
        snapshot.panes.filter((pane) => !pane.thread_id || !archivedThreadIds.has(pane.thread_id)),
      )
    : [];
  const activePane = terminalRoute?.kind === "thread"
    ? snapshot?.panes.find((pane) => pane.thread_id === terminalRoute.id)
    : terminalRoute?.kind === "pane"
      ? snapshot?.panes.find((pane) => pane.pane_id === terminalRoute.id)
      : undefined;
  const hasWorkingDuration = snapshot?.panes.some(
    (pane) => pane.agent_status === "working" && pane.working_started_at,
  ) ?? false;

  useEffect(() => {
    applyAppTheme(settings.theme);
    applyFontSettings(settings);
    storeAppSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!hasWorkingDuration) return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [hasWorkingDuration]);

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
        : paneAction.thread
          ? `/api/threads/${encodeURIComponent(paneAction.thread.thread_id)}`
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

  async function createThread(request: ThreadCreationRequest) {
    if (!creationProject) return;
    setCreationPending(true);
    setCreationError(undefined);
    try {
      const response = await fetch(
        `${bridgeUrl}/api/projects/${encodeURIComponent(creationProject.project_id)}/threads`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
      if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      setCreationProject(undefined);
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : "Unable to create Thread");
    } finally {
      setCreationPending(false);
    }
  }

  if (activePane) {
    return (
      <TerminalView
        bridgeUrl={bridgeUrl}
        pane={activePane}
        themeId={settings.theme}
        fontFamily={settings.terminalFontFamily}
        fontSize={settings.terminalFontSize}
        cursorBlink={settings.terminalCursorBlink}
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
          <button
            className="secondary icon-button settings-trigger"
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </button>
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
      {!paneAction && !creationProject && actionError && <p className="notice error">{actionError}</p>}

      {snapshot && (
        <section className="inventory">
          {projectGroups.map(({ id, label, project, panes }) => (
            <section className="workspace-group" key={id}>
              <h3 className="workspace-divider">
                <span>{label}</span>
                {project && (
                  <button
                    className="project-create secondary icon-button"
                    type="button"
                    disabled={liveSession.status !== "live"}
                    aria-label={`New Thread in ${project.name}`}
                    title={`New Thread in ${project.name}`}
                    onClick={() => {
                      setCreationError(undefined);
                      setCreationProject(project);
                    }}
                  >
                    <PlusIcon />
                  </button>
                )}
              </h3>
              {panes.length > 0 && <div className="pane-list">
                {panes.map((pane) => {
                  const thread = snapshot.threads?.find((candidate) => candidate.thread_id === pane.thread_id);
                  const kind = thread?.agent_session ? "archive" : "delete";
                  return <div className="pane-row" key={pane.pane_id}>
                    <button
                      className={`pane ${pane.agent_status === "working" ? "working" : ""}`}
                      title={pane.pane_id}
                      aria-label={`Open ${paneTitle(pane)}`}
                      onClick={() => openPane(pane)}
                    >
                      {pane.agent_status === "working" && <WorkingActivity themeId={settings.theme} />}
                      <span
                        className={`status ${pane.agent_status ?? "unknown"}`}
                        title={pane.agent_status ?? "unknown"}
                      />
                      <span className="pane-copy">
                        <strong>{paneTitle(pane)}</strong>
                        <small className="pane-detail">
                          {pane.worktree_id && linkedWorktreeIds.has(pane.worktree_id) && (
                            <span className="worktree-indicator" title="Worktree">
                              <WorktreeIcon />
                            </span>
                          )}
                          <span>{paneDetail(pane, clock)}</span>
                        </small>
                      </span>
                    </button>
                    <button
                      className="pane-manage secondary icon-button"
                      type="button"
                      aria-label={`${kind === "archive" ? "Archive" : "Delete"} ${paneTitle(pane)}`}
                      title={kind === "archive" ? "Archive thread" : thread ? "Delete thread" : "Delete pane"}
                      onClick={() => {
                        setActionError(undefined);
                        setPaneAction({
                          kind,
                          pane,
                          thread,
                        });
                      }}
                    >
                      {kind === "archive" ? <ArchiveIcon /> : <TrashIcon />}
                    </button>
                  </div>
                })}
              </div>}
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
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onCancel={() => setSettingsOpen(false)}
          onSave={(nextSettings) => {
            setSettings(nextSettings);
            setSettingsOpen(false);
          }}
        />
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
      {creationProject && snapshot && (
        <ThreadCreationDialog
          project={creationProject}
          worktrees={(snapshot.worktrees ?? []).filter(
            (worktree) => worktree.project_id === creationProject.project_id && !worktree.removed_at,
          )}
          error={creationError}
          pending={creationPending}
          defaultAgent={settings.defaultAgent}
          defaultSkipPermissions={settings.defaultSkipPermissions}
          onCancel={() => {
            setCreationProject(undefined);
            setCreationError(undefined);
          }}
          onCreate={(request) => void createThread(request)}
        />
      )}
    </main>
  );
}
