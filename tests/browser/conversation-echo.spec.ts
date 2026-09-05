import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { capture } from "../../scripts/integrations/capture.mjs";
import type { HerdrAdapter } from "../../src/server/herdr";
import type { SessionStateFeed } from "../../src/server/live-session";
import { createControlServer } from "../../src/server/server";
import { ThreadManager } from "../../src/server/threads";

test("shows one sent message when a provider trims its captured echo", async ({ page }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "control-echo-"));
  const statePath = join(directory, "control.db");
  const threads = new ThreadManager({ path: statePath });
  const snapshot = threads.reconcile({
    version: "0.8.0", protocol: 20,
    workspaces: [{ workspace_id: "w1", label: "Echo fixture", number: 1, tab_count: 1, pane_count: 1, focused: false }],
    tabs: [{ workspace_id: "w1", tab_id: "w1:t1", label: "Echo fixture", number: 1, pane_count: 1, focused: false }],
    panes: [{ workspace_id: "w1", tab_id: "w1:t1", pane_id: "w1:p1", terminal_id: "fixture-terminal",
      agent: "codex", agent_status: "idle", focused: false, label: "Echo fixture",
      agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "fixture-session" } }],
  });
  const thread = threads.list()[0];
  const session: SessionStateFeed = {
    current: () => ({ status: "live", revision: 1, snapshot }),
    subscribe: listener => { listener({ status: "live", revision: 1, snapshot }); return () => undefined; },
    close: () => undefined,
  };
  const echo = (text: string, turn: string) => capture("codex", {
    hook_event_name: "UserPromptSubmit", prompt: text.trim(), session_id: "fixture-session", turn_id: turn,
  }, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/fixture/no-socket", HERDR_CONTROL_STATE: statePath });
  const prompts: string[] = [];
  // Keep HTTP, receipts, hook writing and capture import real. No live Herdr is used.
  const herdr = {
    snapshot: async () => snapshot,
    promptThread: async (_pane: string, text: string) => { prompts.push(text); echo(text, "control-echo"); },
  } as unknown as HerdrAdapter;
  const allowedOrigins = new Set<string>();
  const server = createControlServer({
    host: "127.0.0.1", port: 0, herdrBinary: "/fixture/no-herdr", herdrSocketPath: "/fixture/no-socket",
    statePath, allowedOrigins,
  }, herdr, session, threads, undefined, async () => ["codex"]);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  allowedOrigins.add(url);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/threads/${thread.thread_id}?host=${encodeURIComponent(url)}`);
    const prompt = "Update the documentation ";
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
    const read = async () => (await page.request.get(`${url}/api/threads/${thread.thread_id}/conversation`)).json();
    await expect.poll(async () => (await read()).capture_available).toBe(true);
    expect((await read()).messages).toHaveLength(1);
    await page.reload();
    await expect(page.locator(".conversation-message.user")).toHaveCount(1);
    await expect(page.locator(".delivery.acknowledged")).toHaveText("Sent");
    await page.screenshot({ path: testInfo.outputPath("single-captured-prompt.png") });
    echo(prompt, "control-echo"); // Re-importing the same hook stays idempotent.
    expect((await read()).messages).toHaveLength(1);
    echo(prompt, "desktop-repeat"); // An intentional later prompt stays distinct.
    expect((await read()).messages).toHaveLength(2);
    await page.reload();
    await expect(page.locator(".conversation-message.user")).toHaveCount(2);
    expect(prompts).toEqual([prompt]);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
