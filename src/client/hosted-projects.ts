import type { SessionSnapshot, ThreadInfo } from "../shared/protocol";
import { isRecentArchive } from "../shared/archive-policy";
import type { ControlHost } from "./hosts";
import type { HostSessionFeed } from "./live-session";
import {
  compareProjectActivity,
  groupPanesByProject,
  type ProjectPaneGroup,
} from "./workspace-groups";

export interface HostedProjectGroup extends ProjectPaneGroup {
  key: string;
  host: ControlHost;
  feedStatus: HostSessionFeed["status"];
  snapshot: SessionSnapshot;
}

export interface HostedArchivedThread {
  key: string;
  host: ControlHost;
  feedStatus: HostSessionFeed["status"];
  snapshot: SessionSnapshot;
  thread: ThreadInfo;
}

export interface HostedProject {
  key: string;
  host: ControlHost;
  feedStatus: HostSessionFeed["status"];
  snapshot: SessionSnapshot;
  project: NonNullable<SessionSnapshot["projects"]>[number];
}

/** Produces one globally sorted Project list without adding a host grouping tier. */
export function projectsAcrossHosts(feeds: readonly HostSessionFeed[]): HostedProjectGroup[] {
  return feeds.flatMap((feed) => {
    const snapshot = feed.snapshot;
    if (!snapshot) return [];
    const archivedThreadIds = new Set(
      snapshot.threads
        ?.filter((thread) => thread.lifecycle === "archived")
        .map((thread) => thread.thread_id),
    );
    return groupPanesByProject(
      snapshot.projects ?? [],
      snapshot.worktrees ?? [],
      snapshot.workspaces,
      snapshot.panes.filter((pane) => !pane.thread_id || !archivedThreadIds.has(pane.thread_id)),
    ).map((group) => ({
      ...group,
      key: hostedKey(feed.host.url, group.id),
      host: feed.host,
      feedStatus: feed.status,
      snapshot,
    }));
  }).sort((first, second) => (
    compareProjectActivity(first, second)
    || first.host.label.localeCompare(second.host.label, undefined, { sensitivity: "base" })
    || first.key.localeCompare(second.key)
  ));
}

/** Keeps the complete Project inventory available to the new-Thread flow. */
export function availableProjectsAcrossHosts(feeds: readonly HostSessionFeed[]): HostedProject[] {
  return feeds.flatMap((feed) => {
    const snapshot = feed.snapshot;
    if (!snapshot) return [];
    return (snapshot.projects ?? []).map((project) => ({
      key: hostedKey(feed.host.url, project.project_id),
      host: feed.host,
      feedStatus: feed.status,
      snapshot,
      project,
    }));
  }).sort((first, second) => (
    first.project.name.localeCompare(second.project.name, undefined, { sensitivity: "base" })
    || first.host.label.localeCompare(second.host.label, undefined, { sensitivity: "base" })
    || first.key.localeCompare(second.key)
  ));
}

export function archivedThreadsAcrossHosts(
  feeds: readonly HostSessionFeed[],
): HostedArchivedThread[] {
  return feeds.flatMap((feed) => feed.snapshot?.threads
    ?.filter((thread) => thread.lifecycle === "archived" && thread.agent_session)
    .map((thread) => ({
      key: hostedKey(feed.host.url, thread.thread_id),
      host: feed.host,
      feedStatus: feed.status,
      snapshot: feed.snapshot!,
      thread,
    })) ?? []
  ).sort((first, second) => (
    second.thread.updated_at.localeCompare(first.thread.updated_at)
    || first.key.localeCompare(second.key)
  ));
}

export function recentArchivedThreads(
  threads: readonly HostedArchivedThread[],
  now = Date.now(),
): HostedArchivedThread[] {
  return threads.filter(({ thread }) => isRecentArchive(thread, now));
}

export function hostedKey(hostUrl: string, localId: string): string {
  return `${hostUrl}::${localId}`;
}
