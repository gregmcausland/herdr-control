import { useEffect, useRef, useState } from "react";
import type { PaneInfo } from "../shared/protocol";
import { TerminalView } from "./TerminalView";
import { PlusIcon, ThreadCreationDialog } from "./ThreadCreationDialog";
import { SettingsDialog, SettingsIcon } from "./SettingsDialog";
import { ControlHostsDialog, HostsIcon } from "./ControlHostsDialog";
import { applyFontSettings, readAppSettings, storeAppSettings } from "./settings";
import { applyAppTheme } from "./theme";
import { WorkingActivity } from "./WorkingActivity";
import { workingDuration } from "./working-duration";
import { useControlOrchestration, type PaneAction } from "./orchestration-state";

function feedStatusLabel(status: "connecting" | "live" | "stale"): string {
  return status === "live" ? "Live" : status === "stale" ? "Reconnecting" : "Connecting";
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
                ? `${paneTitle(action.pane)} cannot be resumed yet. The Thread will be permanently removed from Control and its terminal will retire when safe.`
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
  const control = useControlOrchestration();
  const {
    hostConfiguration,
    liveSessions,
    projectGroups,
    archivedThreads,
    activePane,
    terminalSelection,
    settingsOpen,
    hostsOpen,
    paneAction,
    pendingAction,
    actionError,
    restoringThreadKey,
    creationTarget,
    creationPending,
    creationError,
  } = control;
  const [settings, setSettings] = useState(readAppSettings);
  const [clock, setClock] = useState(Date.now);
  const hasWorkingDuration = liveSessions.some((feed) => feed.snapshot?.panes.some(
    (pane) => pane.agent_status === "working" && pane.working_started_at,
  ));

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

  if (activePane) {
    return (
      <TerminalView
        bridgeUrl={terminalSelection!.hostUrl}
        pane={activePane}
        themeId={settings.theme}
        fontFamily={settings.terminalFontFamily}
        fontSize={settings.terminalFontSize}
        cursorBlink={settings.terminalCursorBlink}
        onBack={control.returnHome}
      />
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Herdr Control</h1>
        <div className="masthead-actions">
          <div className="host-status-list" aria-label="Herdr servers">
            {liveSessions.map((feed) => (
              <span
                className={`connection-status host-status ${feed.status}`}
                key={feed.host.url}
                title={`${feed.host.label}: ${feedStatusLabel(feed.status)}${feed.snapshot ? ` · Herdr ${feed.snapshot.version}` : ""}`}
              >
                {feed.host.label}
              </span>
            ))}
          </div>
          <button
            className="secondary icon-button hosts-trigger"
            type="button"
            aria-label="Manage Control Hosts"
            title="Manage Control Hosts"
            onClick={control.openHosts}
          >
            <HostsIcon />
          </button>
          <button
            className="secondary icon-button settings-trigger"
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={control.openSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {projectGroups.length === 0 && liveSessions.every((feed) => feed.status === "connecting") && (
        <p className="notice">Connecting to configured Herdr servers…</p>
      )}
      {liveSessions.filter((feed) => feed.status === "stale" && !feed.snapshot).map((feed) => (
        <p className="notice error" key={feed.host.url}>
          <strong>{feed.host.label}:</strong> {feed.message ?? "Unable to connect to bridge"}
        </p>
      ))}
      {!paneAction && !creationTarget && actionError && <p className="notice error">{actionError}</p>}

      {liveSessions.some((feed) => feed.snapshot) && (
        <section className="inventory">
          {projectGroups.map(({ key, label, project, panes, host, feedStatus, snapshot }) => {
            const linkedWorktreeIds = new Set(
              snapshot.worktrees
                ?.filter((worktree) => worktree.is_linked_worktree)
                .map((worktree) => worktree.worktree_id),
            );
            return (
              <section className="workspace-group" key={key}>
                <h3 className="workspace-divider">
                  <span>{label}</span>
                  <span
                    className={`connection-status project-host ${feedStatus}`}
                    title={`${host.label}: ${feedStatusLabel(feedStatus)}`}
                  >
                    {host.label}
                  </span>
                  {project && (
                    <button
                      className="project-create secondary icon-button"
                      type="button"
                      disabled={feedStatus !== "live"}
                      aria-label={`New Thread in ${project.name} on ${host.label}`}
                      title={`New Thread in ${project.name} on ${host.label}`}
                      onClick={() => control.openCreation({ host, project, snapshot })}
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
                        title={`${host.label} · ${pane.pane_id}`}
                        aria-label={`Open ${paneTitle(pane)} on ${host.label}`}
                        onClick={() => control.openPane(host, pane)}
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
                        disabled={feedStatus !== "live"}
                        aria-label={`${kind === "archive" ? "Archive" : "Delete"} ${paneTitle(pane)} on ${host.label}`}
                        title={kind === "archive" ? "Archive thread" : thread ? "Delete thread" : "Delete pane"}
                        onClick={() => control.openPaneAction({ kind, host, pane, thread })}
                      >
                        {kind === "archive" ? <ArchiveIcon /> : <TrashIcon />}
                      </button>
                    </div>
                  })}
                </div>}
              </section>
            );
          })}
          {archivedThreads.length > 0 && (
            <section className="workspace-group archived-group">
              <h3 className="workspace-divider">Archived</h3>
              <div className="pane-list archived-list">
                {archivedThreads.map((archived) => {
                  const { thread } = archived;
                  return (
                    <div className="archived-thread" key={archived.key}>
                      <span className="archived-thread-icon" aria-hidden="true"><ArchiveIcon /></span>
                      <span className="archived-thread-title">
                        {thread.title}
                        <small>{archived.host.label}</small>
                      </span>
                      {thread.agent_session && !thread.current_run && (
                        <button
                          className="secondary archived-restore"
                          type="button"
                          disabled={
                            archived.feedStatus !== "live"
                            || thread.restoring
                            || restoringThreadKey === archived.key
                          }
                          onClick={() => void control.restoreThread(archived)}
                        >
                          {thread.restoring || restoringThreadKey === archived.key ? "Restoring…" : "Restore"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onCancel={control.closeSettings}
          onSave={(nextSettings) => {
            setSettings(nextSettings);
            control.closeSettings();
          }}
        />
      )}
      {hostsOpen && (
        <ControlHostsDialog
          configuration={hostConfiguration}
          liveStatus={new Map(liveSessions.map((feed) => [feed.host.url, feed.status]))}
          onClose={control.closeHosts}
        />
      )}
      {paneAction && (
        <PaneActionDialog
          action={paneAction}
          error={actionError}
          pending={pendingAction}
          onCancel={control.cancelPaneAction}
          onConfirm={() => void control.confirmPaneAction()}
        />
      )}
      {creationTarget && (
        <ThreadCreationDialog
          project={creationTarget.project}
          worktrees={(creationTarget.snapshot.worktrees ?? []).filter(
            (worktree) => worktree.project_id === creationTarget.project.project_id && !worktree.removed_at,
          )}
          error={creationError}
          pending={creationPending}
          defaultAgent={settings.defaultAgent}
          defaultSkipPermissions={settings.defaultSkipPermissions}
          onCancel={control.cancelCreation}
          onCreate={(request) => void control.createThread(request)}
        />
      )}
    </main>
  );
}
