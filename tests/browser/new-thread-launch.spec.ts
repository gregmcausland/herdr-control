import { expect, test } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { HerdrAdapter } from "../../src/server/herdr";
import type { SessionStateFeed } from "../../src/server/live-session";
import { createControlServer } from "../../src/server/server";
import { ThreadManager } from "../../src/server/threads";
import type { SessionFeedState } from "../../src/shared/protocol";

test("starts a thread through Control while Herdr is still detecting the agent", async ({ page }, testInfo) => {
  const threads = new ThreadManager({ path: ":memory:" });
  const snapshot = threads.reconcile({
    version: "0.8.0", protocol: 20,
    workspaces: [{ workspace_id: "w1", label: "Phone project", number: 1, tab_count: 0, pane_count: 0, focused: true }],
    tabs: [], panes: [],
    repositories: [{
      repo_key: "/fixture/.git", repo_name: "Phone project", repo_root: "/fixture",
      source_checkout_path: "/fixture", source_workspace_id: "w1",
      worktrees: [{ path: "/fixture", label: "main", branch: "main", is_bare: false,
        is_detached: false, is_linked_worktree: false, is_prunable: false, open_workspace_id: "w1" }],
    }],
  });
  let state: SessionFeedState = { status: "live", revision: 1, snapshot };
  const listeners = new Set<(state: SessionFeedState) => void>();
  const session: SessionStateFeed = {
    current: () => state,
    subscribe: listener => { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    requestRefresh: () => {
      state = { status: "live", revision: 2, snapshot: threads.reconcile({
        ...snapshot,
        tabs: [{ workspace_id: "w1", tab_id: "w1:t2", label: "Test", number: 1, pane_count: 1, focused: false }],
        panes: [{ workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p2", terminal_id: "fixture-terminal",
          name: agentName, label: "Test", agent: "codex", agent_status: "working", cwd: "/fixture", focused: false }],
      }) };
      for (const listener of listeners) listener(state);
    },
    close: () => undefined,
  };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let agentName = "";
  let inspections = 0;
  // Use the real HTTP handler, lifecycle, adapter and parser. Only the Herdr
  // transport is replaced, so this test cannot launch or prompt a live agent.
  const herdr = new HerdrAdapter("/fixture/no-herdr", "/fixture/no-socket", async (_socket, method, params) => {
    calls.push({ method, params });
    if (method === "tab.create") return { result: {
      type: "tab_created", tab: { tab_id: "w1:t2", workspace_id: "w1" }, root_pane: { pane_id: "w1:p2" },
    } };
    if (method === "pane.rename" || method === "pane.report_metadata") return { result: {} };
    if (method === "agent.start") agentName = String(params.name);
    if (method === "agent.start" || method === "agent.get") {
      if (method === "agent.get") inspections++;
      // Herdr AgentInfo omits undetected agent types and false readiness flags.
      return { result: {
        type: method === "agent.start" ? "agent_started" : "agent_info",
        agent: {
          terminal_id: "fixture-terminal", pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1",
          name: agentName, agent_status: "idle", focused: false, state_change_seq: 0, revision: 1,
          ...(inspections >= 1 ? { agent: "codex" } : {}),
          ...(inspections >= 2 ? { interactive_ready: true } : { launch_pending: true }),
        },
      } };
    }
    if (method === "agent.prompt") {
      expect(inspections).toBe(2);
      return { result: { type: "agent_prompted" } };
    }
    throw new Error(`Unexpected Herdr request: ${method}`);
  });
  const allowedOrigins = new Set<string>();
  const server = createControlServer({
    host: "127.0.0.1", port: 0, herdrBinary: "/fixture/no-herdr", herdrSocketPath: "/fixture/no-socket",
    statePath: ":memory:", allowedOrigins,
  }, herdr, session, threads, undefined, async () => ["codex"]);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  allowedOrigins.add(url);
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await expect(page.getByText("No active threads.")).toBeVisible();
    await page.getByRole("button", { name: "New thread", exact: true }).click();
    await page.getByRole("dialog", { name: "Choose a project" }).getByRole("button", { name: /Phone project/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Codex", exact: true }).click();
    const form = page.getByRole("dialog", { name: "New thread", exact: true });
    await form.getByLabel("What should Codex work on?").fill("Test");
    const responsePromise = page.waitForResponse(response => response.request().method() === "POST");
    await form.getByRole("button", { name: "Start Thread" }).click();
    const response = await responsePromise;
    const body = await response.json();
    await page.screenshot({ path: testInfo.outputPath("launch-result.png") });
    expect(response.status(), JSON.stringify(body)).toBe(201);
    await expect(form).toHaveCount(0);
    await expect(page.locator(".conversation-header")).toContainText("Live");
    await expect(page.locator(".conversation-reader .notice")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open terminal", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("conversation-opened.png") });
    expect(calls.map(call => call.method)).toEqual([
      "tab.create", "pane.rename", "agent.start", "agent.get", "agent.get", "pane.report_metadata", "agent.prompt",
    ]);
    expect(calls.at(-1)?.params).toEqual({ target: "w1:p2", text: "Test" });
    expect(browserErrors).toEqual([]);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
