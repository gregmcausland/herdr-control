import { expect, test, type Page } from "@playwright/test";

const client = process.env.HERDR_CONTROL_TEST_CLIENT;
const thread = {
  thread_id: "thread-1", title: "Fix mobile reconnects", agent: "codex", lifecycle: "open",
  agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "session-1" },
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  current_run: { run_id: "run-1", terminal_id: "terminal-1", pane_id: "w1:p1", workspace_id: "w1", workspace_label: "Control", tab_id: "w1:t1", started_at: new Date().toISOString(), agent_status: "idle" },
};
const snapshot = {
  version: "test", protocol: 19, threads: [thread],
  workspaces: [{ workspace_id: "w1", label: "Control", number: 1, tab_count: 1, pane_count: 1, focused: false }], tabs: [],
  panes: [{ ...thread.current_run, thread_id: thread.thread_id, agent: "codex", label: thread.title, focused: false }],
};

async function fixture(page: Page) {
  // Route fixtures return finite SSE bodies; keep the simulated feed open.
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      set onerror(_listener: unknown) {}
      get onerror() { return null; }
    } as typeof EventSource;
  });
  const messages: any[] = [{ message_id: "reply-1", sequence: 1, thread_id: thread.thread_id, role: "assistant", source: "agent", created_at: new Date().toISOString(), text: "## Ready to review\n\nThe reconnect fix is ready.\n\n- Drafts survive navigation.\n- [Read the docs](https://example.com).\n\n<script>window.injected = true</script>" }];
  const submissions: any[] = [];
  const sockets: string[] = [];
  let offline = false;
  let loseAcknowledgement = false;
  await page.route("**/api/control-hosts", (route) => route.fulfill({ json: { hosts: [] } }));
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: ["codex"] } }));
  await page.route("**/api/session/events", (route) => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ status: offline ? "stale" : "live", revision: 1, snapshot })}\n\n` }));
  await page.route("**/api/threads/thread-1/conversation*", (route) => offline ? route.abort() : route.fulfill({ json: { thread, messages, capture_available: true, has_older: false } }));
  await page.route("**/api/threads/thread-1/messages", async (route) => {
    const input = route.request().postDataJSON();
    submissions.push(input);
    let message = messages.find((message) => message.message_id === input.message_id);
    if (!message) {
      message = { message_id: input.message_id, sequence: messages.length + 1, thread_id: thread.thread_id, text: input.text, role: "user", source: "control", delivery: "acknowledged", created_at: new Date().toISOString() };
      messages.push(message);
    }
    if (loseAcknowledgement) { loseAcknowledgement = false; await route.abort(); }
    else await route.fulfill({ json: { acknowledged: true, message } });
  });
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    sockets.push(socket.url());
    socket.onMessage((message) => {
      const { type } = JSON.parse(String(message));
      if (type === "release") socket.send(JSON.stringify({ type: "released" }));
      if (type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    });
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });
  return { messages, submissions, sockets, offline: (value: boolean) => { offline = value; }, loseAcknowledgement: () => { loseAcknowledgement = true; } };
}

async function open(page: Page) {
  await page.goto(`${client}/threads/thread-1?host=${encodeURIComponent(client!)}`);
  await expect(page.getByRole("heading", { name: "Ready to review" })).toBeVisible();
}

test("reads replies and preserves drafts across navigation, reload and terminal drill-down", async ({ browser }) => {
  test.skip(!client, "Browser client required");
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const state = await fixture(page);
  await open(page);
  expect(state.sockets).toHaveLength(0);
  await expect(page.locator(".message-markdown script")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Please explain the change\non my phone");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Open Fix mobile reconnects on Custom host" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  expect(state.sockets).toHaveLength(0);
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  expect(state.sockets).toHaveLength(1);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  await page.setViewportSize({ width: 390, height: 430 });
  const send = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
  expect(send!.y + send!.height).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/herdr-control-conversation-mobile.png" });
  await context.close();
});

test("recovers a lost send acknowledgement through its durable receipt", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await open(page);
  state.loseAcknowledgement();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Continue with the fix");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
  await expect(page.locator(".conversation-message.user")).toHaveCount(1);
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0].message_id).toBeTruthy();
  expect(state.sockets).toHaveLength(0);
});

test("keeps cached replies and drafts readable while the host is unavailable", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await open(page);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("A draft while offline");
  state.offline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ready to review" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("A draft while offline");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  state.offline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  expect(state.sockets).toHaveLength(0);
});
