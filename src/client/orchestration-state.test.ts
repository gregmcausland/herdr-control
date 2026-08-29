import { describe, expect, it } from "vitest";
import {
  initialOrchestrationState,
  orchestrationReducer,
  type PaneAction,
} from "./orchestration-state";

const paneAction = {
  kind: "delete",
  host: { label: "Server", url: "https://server.example" },
  pane: {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "t1",
    focused: true,
  },
} satisfies PaneAction;

describe("orchestrationReducer", () => {
  it("keeps pane request and modal transitions coherent", () => {
    let state = initialOrchestrationState();
    state = orchestrationReducer(state, { type: "pane_action.opened", action: paneAction });
    state = orchestrationReducer(state, { type: "pane_action.started" });
    expect(state).toMatchObject({ paneAction, pendingAction: true, actionError: undefined });

    state = orchestrationReducer(state, { type: "pane_action.failed", error: "Bridge unavailable" });
    expect(state).toMatchObject({ paneAction, pendingAction: false, actionError: "Bridge unavailable" });

    state = orchestrationReducer(state, { type: "pane_action.cancelled" });
    expect(state).toMatchObject({ paneAction: undefined, pendingAction: false, actionError: undefined });
  });

  it("clears completed creation state and keeps failed creation open", () => {
    const target = {
      host: paneAction.host,
      project: {
        project_id: "project-1",
        name: "Control",
        repo_key: "/control/.git",
        repo_root: "/control",
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:00:00.000Z",
      },
      snapshot: { version: "test", protocol: 19, workspaces: [], tabs: [], panes: [] },
    };
    let state = orchestrationReducer(initialOrchestrationState(), { type: "creation_launcher.opened", target });
    expect(state.creationLauncherTarget).toBe(target);

    state = orchestrationReducer(state, { type: "creation.opened", target, agent: "pi" });
    expect(state).toMatchObject({ creationLauncherTarget: undefined, creationTarget: target, creationAgent: "pi" });
    state = orchestrationReducer(state, { type: "creation.started" });
    state = orchestrationReducer(state, { type: "creation.failed", error: "No route" });
    expect(state).toMatchObject({ creationTarget: target, creationPending: false, creationError: "No route" });

    state = orchestrationReducer(state, { type: "creation.started" });
    state = orchestrationReducer(state, { type: "creation.completed" });
    expect(state).toMatchObject({ creationTarget: undefined, creationAgent: undefined, creationPending: false });
  });

  it("opens and closes the archive screen", () => {
    let state = orchestrationReducer(initialOrchestrationState(), { type: "archive.opened" });
    expect(state.archiveOpen).toBe(true);
    state = orchestrationReducer(state, { type: "archive.closed" });
    expect(state.archiveOpen).toBe(false);
  });
});
