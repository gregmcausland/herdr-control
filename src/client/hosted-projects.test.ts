import { describe, expect, it } from "vitest";
import type { PaneInfo, ProjectInfo, SessionSnapshot } from "../shared/protocol";
import type { ControlHost } from "./hosts";
import { archivedThreadsAcrossHosts, projectsAcrossHosts } from "./hosted-projects";
import type { HostSessionFeed } from "./live-session";

const serverMz = { label: "Server MZ", url: "https://server.example" } satisfies ControlHost;
const alienMz = { label: "Alien MZ", url: "https://alien.example" } satisfies ControlHost;

function project(name: string, lastRunAt?: string): ProjectInfo {
  return {
    project_id: "shared-project-id",
    name,
    repo_key: `/projects/${name.toLowerCase()}/.git`,
    repo_root: `/projects/${name.toLowerCase()}`,
    last_run_at: lastRunAt,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

function pane(host: string, runStartedAt?: string): PaneInfo {
  return {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: `${host}-terminal`,
    project_id: "shared-project-id",
    run_id: runStartedAt ? `${host}-run` : undefined,
    run_started_at: runStartedAt,
    focused: false,
  };
}

function snapshot(projectInfo: ProjectInfo, paneInfo: PaneInfo): SessionSnapshot {
  return {
    version: "0.8.0",
    protocol: 19,
    workspaces: [{
      workspace_id: "w1",
      label: projectInfo.name,
      number: 1,
      tab_count: 1,
      pane_count: 1,
      focused: false,
    }],
    tabs: [],
    panes: [paneInfo],
    projects: [projectInfo],
    threads: [],
  };
}

function feed(host: ControlHost, state: Partial<HostSessionFeed> = {}): HostSessionFeed {
  return { host, status: "live", revision: 1, ...state };
}

describe("multi-host Project projection", () => {
  it("keeps Project as the top-level group and qualifies colliding IDs by host", () => {
    const groups = projectsAcrossHosts([
      feed(serverMz, { snapshot: snapshot(project("Control"), pane("server")) }),
      feed(alienMz, {
        snapshot: snapshot(project("Control", "2026-08-25T12:00:00.000Z"), pane("alien")),
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(({ label, host }) => [label, host.label])).toEqual([
      ["Control", "Alien MZ"],
      ["Control", "Server MZ"],
    ]);
    expect(new Set(groups.map(({ key }) => key)).size).toBe(2);
  });

  it("sorts current Runs globally and retains a stale host's last snapshot", () => {
    const groups = projectsAcrossHosts([
      feed(serverMz, {
        status: "stale",
        snapshot: snapshot(project("Older"), pane("server", "2026-08-25T11:00:00.000Z")),
      }),
      feed(alienMz, {
        snapshot: snapshot(project("Latest"), pane("alien", "2026-08-25T13:00:00.000Z")),
      }),
      feed({ label: "Offline", url: "https://offline.example" }, { status: "stale" }),
    ]);

    expect(groups.map(({ label }) => label)).toEqual(["Latest", "Older"]);
    expect(groups[1].feedStatus).toBe("stale");
  });

  it("qualifies archived Threads from different hosts", () => {
    const sharedThread = {
      thread_id: "shared-thread-id",
      project_id: "shared-project-id",
      title: "Architecture",
      agent: "pi",
      agent_session: { source: "herdr:pi", agent: "pi", kind: "path", value: "/session" },
      lifecycle: "archived" as const,
      created_at: "2026-08-25T10:00:00.000Z",
      updated_at: "2026-08-25T11:00:00.000Z",
    };
    const first = snapshot(project("Control"), pane("server"));
    const second = snapshot(project("Control"), pane("alien"));
    first.threads = [sharedThread];
    second.threads = [sharedThread];

    const threads = archivedThreadsAcrossHosts([
      feed(serverMz, { snapshot: first }),
      feed(alienMz, { snapshot: second }),
    ]);

    expect(threads).toHaveLength(2);
    expect(new Set(threads.map(({ key }) => key)).size).toBe(2);
  });
});
