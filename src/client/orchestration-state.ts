import { useEffect, useReducer, useState } from "react";
import type {
  PaneInfo,
  ProjectInfo,
  SessionSnapshot,
  ThreadCreationRequest,
  ThreadInfo,
} from "../shared/protocol";
import { useControlHosts } from "./control-hosts";
import {
  availableProjectsAcrossHosts,
  archivedThreadsAcrossHosts,
  projectsAcrossHosts,
  recentArchivedThreads,
  type HostedArchivedThread,
} from "./hosted-projects";
import { normalizeHost, resolveInitialHost, type ControlHost } from "./hosts";
import { useHostAgentInventories } from "./host-agent-inventory";
import { useLiveSessions } from "./live-session";
import {
  homePath,
  panePath,
  searchForHost,
  terminalRouteFromPath,
  threadPath,
  threadTerminalPath,
  type TerminalRoute,
} from "./routes";

const STORAGE_KEY = "herdr-control-host";

export type PaneAction = {
  kind: "archive" | "delete";
  host: ControlHost;
  pane: PaneInfo;
  thread?: ThreadInfo;
};

export type CreationTarget = {
  host: ControlHost;
  project: ProjectInfo;
  snapshot: SessionSnapshot;
};

export type TerminalSelection = {
  hostUrl: string;
  route: TerminalRoute;
};

export interface OrchestrationState {
  terminalSelection?: TerminalSelection;
  settingsOpen: boolean;
  hostsOpen: boolean;
  archiveOpen: boolean;
  projectPickerOpen: boolean;
  paneAction?: PaneAction;
  pendingAction: boolean;
  actionError?: string;
  restoringThreadKey?: string;
  creationLauncherTarget?: CreationTarget;
  creationTarget?: CreationTarget;
  creationAgent?: string;
  creationPending: boolean;
  creationError?: string;
}

export type OrchestrationEvent =
  | { type: "terminal.opened"; selection: TerminalSelection }
  | { type: "terminal.closed" }
  | { type: "settings.opened" | "settings.closed" | "hosts.opened" | "hosts.closed" | "archive.opened" | "archive.closed" | "project_picker.opened" | "project_picker.closed" }
  | { type: "pane_action.opened"; action: PaneAction }
  | { type: "pane_action.cancelled" | "pane_action.started" | "pane_action.completed" }
  | { type: "pane_action.failed"; error: string }
  | { type: "restore.started"; key: string }
  | { type: "restore.completed"; error?: string }
  | { type: "creation_launcher.opened"; target: CreationTarget }
  | { type: "creation_launcher.cancelled" }
  | { type: "creation.opened"; target: CreationTarget; agent?: string }
  | { type: "creation.cancelled" | "creation.started" | "creation.completed" }
  | { type: "creation.failed"; error: string };

export function initialOrchestrationState(
  terminalSelection?: TerminalSelection,
): OrchestrationState {
  return {
    terminalSelection,
    settingsOpen: false,
    hostsOpen: false,
    archiveOpen: false,
    projectPickerOpen: false,
    pendingAction: false,
    creationPending: false,
  };
}

/** Keeps route, request, pending, and task-view transitions explicit and testable. */
export function orchestrationReducer(
  state: OrchestrationState,
  event: OrchestrationEvent,
): OrchestrationState {
  switch (event.type) {
    case "terminal.opened": return { ...state, terminalSelection: event.selection };
    case "terminal.closed": return { ...state, terminalSelection: undefined };
    case "settings.opened": return { ...state, settingsOpen: true };
    case "settings.closed": return { ...state, settingsOpen: false };
    case "hosts.opened": return { ...state, hostsOpen: true };
    case "hosts.closed": return { ...state, hostsOpen: false };
    case "archive.opened": return { ...state, archiveOpen: true };
    case "archive.closed": return { ...state, archiveOpen: false };
    case "project_picker.opened": return { ...state, projectPickerOpen: true };
    case "project_picker.closed": return { ...state, projectPickerOpen: false };
    case "pane_action.opened":
      return { ...state, paneAction: event.action, actionError: undefined };
    case "pane_action.cancelled":
      return { ...state, paneAction: undefined, actionError: undefined };
    case "pane_action.started":
      return { ...state, pendingAction: true, actionError: undefined };
    case "pane_action.completed":
      return { ...state, pendingAction: false, paneAction: undefined };
    case "pane_action.failed":
      return { ...state, pendingAction: false, actionError: event.error };
    case "restore.started":
      return { ...state, restoringThreadKey: event.key, actionError: undefined };
    case "restore.completed":
      return { ...state, restoringThreadKey: undefined, actionError: event.error };
    case "creation_launcher.opened":
      return { ...state, projectPickerOpen: false, creationLauncherTarget: event.target, creationError: undefined };
    case "creation_launcher.cancelled":
      return { ...state, creationLauncherTarget: undefined };
    case "creation.opened":
      return {
        ...state,
        creationLauncherTarget: undefined,
        creationTarget: event.target,
        creationAgent: event.agent,
        creationError: undefined,
      };
    case "creation.cancelled":
      return { ...state, creationTarget: undefined, creationAgent: undefined, creationError: undefined };
    case "creation.started":
      return { ...state, creationPending: true, creationError: undefined };
    case "creation.completed":
      return {
        ...state,
        creationPending: false,
        creationTarget: undefined,
        creationAgent: undefined,
      };
    case "creation.failed":
      return { ...state, creationPending: false, creationError: event.error };
  }
}

/** Coordinates browser state with every configured bridge while App renders the result. */
export function useControlOrchestration() {
  const [preferredHostUrl, setPreferredHostUrl] = useState(initialHost);
  const homeBridge = homeBridgeUrl();
  const hostConfiguration = useControlHosts(homeBridge, preferredHostUrl);
  const liveSessions = useLiveSessions(hostConfiguration.hosts);
  const agentInventories = useHostAgentInventories(hostConfiguration.hosts);
  const [state, dispatch] = useReducer(
    orchestrationReducer,
    terminalSelectionFromLocation(),
    initialOrchestrationState,
  );
  const activeFeed = state.terminalSelection
    ? liveSessions.find((feed) => feed.host.url === state.terminalSelection!.hostUrl)
    : undefined;
  const activeSnapshot = activeFeed?.snapshot;
  const activePane = state.terminalSelection?.route.kind === "thread"
    ? activeSnapshot?.panes.find((pane) => pane.thread_id === state.terminalSelection!.route.id)
    : state.terminalSelection?.route.kind === "pane"
      ? activeSnapshot?.panes.find((pane) => pane.pane_id === state.terminalSelection!.route.id)
      : undefined;
  const archivedThreads = archivedThreadsAcrossHosts(liveSessions);

  useEffect(() => {
    const followBrowserHistory = () => {
      const selection = terminalSelectionFromLocation();
      if (selection) {
        setPreferredHostUrl(selection.hostUrl);
        dispatch({ type: "terminal.opened", selection });
      } else {
        dispatch({ type: "terminal.closed" });
      }
    };
    window.addEventListener("popstate", followBrowserHistory);
    return () => window.removeEventListener("popstate", followBrowserHistory);
  }, []);

  useEffect(() => {
    if (
      hostConfiguration.status !== "database"
      || state.terminalSelection
      || new URLSearchParams(window.location.search).has("host")
      || hostConfiguration.storedHosts.some((host) => host.url === preferredHostUrl)
      || preferredHostUrl === homeBridge
    ) return;
    localStorage.removeItem(STORAGE_KEY);
    setPreferredHostUrl(homeBridge);
  }, [homeBridge, hostConfiguration.status, hostConfiguration.storedHosts, preferredHostUrl, state.terminalSelection]);
  useEffect(() => {
    if (state.terminalSelection?.route.kind !== "pane" || !activePane?.thread_id || !activeFeed) return;
    const route: TerminalRoute = { kind: "thread", id: activePane.thread_id };
    window.history.replaceState(null, "", threadPath(route.id, window.location.search));
    dispatch({ type: "terminal.opened", selection: { hostUrl: activeFeed.host.url, route } });
  }, [activePane?.thread_id, activeFeed?.host.url, state.terminalSelection]);

  function openPane(host: ControlHost, pane: PaneInfo) {
    const route: TerminalRoute = pane.thread_id
      ? { kind: "thread", id: pane.thread_id }
      : { kind: "pane", id: pane.pane_id };
    const search = searchForHost(host.url, window.location.search);
    const path = route.kind === "thread" ? threadPath(route.id, search) : panePath(route.id, search);
    localStorage.setItem(STORAGE_KEY, host.url);
    setPreferredHostUrl(host.url);
    window.history.pushState(null, "", path);
    dispatch({ type: "terminal.opened", selection: { route, hostUrl: host.url } });
  }

  function openThread(host: ControlHost, threadId: string, terminal = false) {
    const search = searchForHost(host.url, window.location.search);
    window.history.pushState(null, "", terminal ? threadTerminalPath(threadId, search) : threadPath(threadId, search));
    setPreferredHostUrl(host.url);
    localStorage.setItem(STORAGE_KEY, host.url);
    dispatch({ type: "terminal.opened", selection: { hostUrl: host.url, route: { kind: "thread", id: threadId, ...(terminal ? { terminal: true } : {}) } } });
  }

  function returnHome() {
    window.history.pushState(null, "", homePath(window.location.search));
    dispatch({ type: "terminal.closed" });
  }

  async function confirmPaneAction() {
    const action = state.paneAction;
    if (!action) return;
    dispatch({ type: "pane_action.started" });
    try {
      const path = action.kind === "archive"
        ? `/api/threads/${encodeURIComponent(action.pane.thread_id!)}/archive`
        : action.thread
          ? `/api/threads/${encodeURIComponent(action.thread.thread_id)}`
          : `/api/panes/${encodeURIComponent(action.pane.pane_id)}`;
      await sendAction(action.host.url, path, action.kind === "archive" ? "POST" : "DELETE");
      dispatch({ type: "pane_action.completed" });
    } catch (error) {
      dispatch({
        type: "pane_action.failed",
        error: error instanceof Error ? error.message : `Unable to ${action.kind} pane`,
      });
    }
  }

  async function restoreThread(archived: HostedArchivedThread) {
    dispatch({ type: "restore.started", key: archived.key });
    try {
      await sendAction(
        archived.host.url,
        `/api/threads/${encodeURIComponent(archived.thread.thread_id)}/restore`,
        "POST",
      );
      dispatch({ type: "restore.completed" });
      openThread(archived.host, archived.thread.thread_id);
    } catch (error) {
      dispatch({
        type: "restore.completed",
        error: error instanceof Error ? error.message : "Unable to restore Thread",
      });
    }
  }

  async function createThread(request: ThreadCreationRequest) {
    const target = state.creationTarget;
    if (!target) return;
    dispatch({ type: "creation.started" });
    try {
      const response = await fetch(
        `${target.host.url}/api/projects/${encodeURIComponent(target.project.project_id)}/threads`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const body = await response.json().catch(() => undefined) as { error?: string; thread?: { pane_id: string } } | undefined;
      if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
      dispatch({ type: "creation.completed" });
      if (body?.thread) {
        const paneId = body.thread.pane_id;
        // A launch is acknowledged before the feed necessarily adopts its Thread.
        window.history.pushState(null, "", panePath(paneId, searchForHost(target.host.url, window.location.search)));
        dispatch({ type: "terminal.opened", selection: { hostUrl: target.host.url, route: { kind: "pane", id: paneId } } });
      }
    } catch (error) {
      dispatch({
        type: "creation.failed",
        error: error instanceof Error ? error.message : "Unable to create Thread",
      });
    }
  }

  return {
    ...state,
    hostConfiguration,
    liveSessions,
    agentInventories,
    projectGroups: projectsAcrossHosts(liveSessions),
    availableProjects: availableProjectsAcrossHosts(liveSessions),
    archivedThreads,
    recentArchivedThreads: recentArchivedThreads(archivedThreads),
    activePane,
    activeFeed,
    openThread,
    openPane,
    returnHome,
    openSettings: () => dispatch({ type: "settings.opened" }),
    closeSettings: () => dispatch({ type: "settings.closed" }),
    openHosts: () => dispatch({ type: "hosts.opened" }),
    closeHosts: () => dispatch({ type: "hosts.closed" }),
    openArchive: () => dispatch({ type: "archive.opened" }),
    closeArchive: () => dispatch({ type: "archive.closed" }),
    openProjectPicker: () => dispatch({ type: "project_picker.opened" }),
    closeProjectPicker: () => dispatch({ type: "project_picker.closed" }),
    openPaneAction: (action: PaneAction) => dispatch({ type: "pane_action.opened", action }),
    cancelPaneAction: () => dispatch({ type: "pane_action.cancelled" }),
    confirmPaneAction,
    restoreThread,
    openCreationLauncher: (target: CreationTarget) => dispatch({ type: "creation_launcher.opened", target }),
    cancelCreationLauncher: () => dispatch({ type: "creation_launcher.cancelled" }),
    openCreation: (target: CreationTarget, agent?: string) => dispatch({ type: "creation.opened", target, agent }),
    cancelCreation: () => dispatch({ type: "creation.cancelled" }),
    createThread,
  };
}

function initialHost(): string {
  return resolveInitialHost(
    window.location.search,
    localStorage.getItem(STORAGE_KEY),
    window.location.origin,
  );
}

function homeBridgeUrl(): string {
  const origin = normalizeHost(window.location.origin);
  return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) && window.location.port === "5173"
    ? initialHost()
    : origin;
}

function terminalSelectionFromLocation(): TerminalSelection | undefined {
  const route = terminalRouteFromPath(window.location.pathname);
  return route ? { route, hostUrl: initialHost() } : undefined;
}

async function sendAction(hostUrl: string, path: string, method: "POST" | "DELETE"): Promise<void> {
  const response = await fetch(`${hostUrl}${path}`, { method });
  const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Request failed with status ${response.status}`);
}
