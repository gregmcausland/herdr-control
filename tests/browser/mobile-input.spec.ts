import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;

const snapshot = {
  version: "test",
  protocol: 1,
  workspaces: [{ workspace_id: "w1", label: "Test", number: 1, tab_count: 1, pane_count: 1, focused: true }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Test", number: 1, pane_count: 1, focused: true }],
  panes: [{
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term_test",
    terminal_title_stripped: "Test pane",
    cwd: "/tmp",
    agent: "codex",
    agent_status: "done",
    thread_id: "thread-test",
    run_id: "run-test",
    focused: true,
  }],
  threads: [{
    thread_id: "thread-test",
    title: "Test pane",
    agent: "codex",
    lifecycle: "open",
    created_at: "2026-08-19T12:00:00.000Z",
    updated_at: "2026-08-19T12:00:00.000Z",
    current_run: {
      run_id: "run-test",
      workspace_id: "w1",
      workspace_label: "Test",
      tab_id: "w1:t1",
      pane_id: "w1:p1",
      terminal_id: "term_test",
      agent_status: "done",
      started_at: "2026-08-19T12:00:00.000Z",
    },
  }],
};

async function mockTerminal(
  page: Page,
  sent: Array<{ type: string; data?: string; key?: string }>,
  opened: string[] = [],
  connections: WebSocketRoute[] = [],
) {
  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    opened.push(socket.url());
    connections.push(socket);
    socket.onMessage((message) => sent.push(JSON.parse(message.toString())));
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });
}

async function openTerminal(
  context: BrowserContext,
  sent: Array<{ type: string; data?: string; key?: string }>,
  opened?: string[],
) {
  const page = await context.newPage();
  await mockTerminal(page, sent, opened);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button", { name: "Open Test pane" }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/threads/thread-test");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect.poll(() => sent.some((message) => message.type === "view")).toBe(true);
  return page;
}

async function setPageVisibility(page: Page, visibility: DocumentVisibilityState) {
  await page.evaluate((nextVisibility) => {
    const testWindow = window as typeof window & { testVisibility?: DocumentVisibilityState };
    testWindow.testVisibility = nextVisibility;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => testWindow.testVisibility,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => testWindow.testVisibility === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}

test("restores a routed terminal after refresh and follows browser history", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  await mockTerminal(page, []);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button", { name: "Open Test pane" }).click();

  await page.reload();
  await expect(page.locator(".terminal-heading strong")).toHaveText("Test pane");
  await page.goBack();
  await expect(page.getByRole("button", { name: "Open Test pane" })).toBeVisible();
});

test("reclaims uncontested control when returning to a backgrounded terminal", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const sent: Array<{ type: string }> = [];
  const opened: string[] = [];
  await mockTerminal(page, sent, opened);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button", { name: "Open Test pane" }).click();
  await expect.poll(() => opened.length).toBe(1);

  await setPageVisibility(page, "hidden");
  await expect.poll(() => sent.some((message) => message.type === "release")).toBe(true);
  await setPageVisibility(page, "visible");

  await expect.poll(() => opened.length).toBe(2);
  expect(new URL(opened[1]).searchParams.get("takeover")).toBe("false");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
});

test("reclaims uncontested control after the terminal bridge disconnects", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const opened: string[] = [];
  const connections: WebSocketRoute[] = [];
  await mockTerminal(page, [], opened, connections);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button", { name: "Open Test pane" }).click();
  await expect.poll(() => connections.length).toBe(1);

  await connections[0].close({ code: 1012, reason: "Bridge restarted" });

  await expect.poll(() => connections.length).toBe(2);
  expect(new URL(opened[1]).searchParams.get("takeover")).toBe("false");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
});

test("offers local message composition and terminal keys only on mobile", async ({ browser }) => {
  test.skip(!clientUrl, "A running browser client is required");

  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const sent: Array<{ type: string; data?: string; key?: string }> = [];
  const page = await openTerminal(mobile, sent);

  const controls = page.getByRole("navigation", { name: "Terminal controls" });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Esc", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Message" }).click();
  const composer = page.getByPlaceholder("Prepare a message locally…");
  await composer.fill("A locally edited\nmessage");
  await page.getByRole("button", { name: "Close message composer" }).click();
  await page.getByRole("button", { name: "Message" }).click();
  await expect(composer).toHaveValue("A locally edited\nmessage");
  await page.screenshot({ path: "test-results/mobile-composer.png", fullPage: true });
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect.poll(() => sent.filter((message) => message.type === "input").map((message) => message.data)).toEqual([
    "A locally edited\rmessage",
  ]);
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: "key", key: "enter" });
  await page.getByRole("button", { name: "Keys", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Terminal keys" })).toBeVisible();
  await page.getByRole("button", { name: "Esc", exact: true }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: "key", key: "esc" });
  await expect(page.getByRole("dialog", { name: "Terminal keys" })).toBeVisible();
  await mobile.close();

  const medium = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const mediumPage = await medium.newPage();
  await mockTerminal(mediumPage, []);
  await mediumPage.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  expect(await mediumPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await medium.close();

  const desktop = await browser.newContext({ viewport: { width: 2560, height: 800 } });
  const opened: string[] = [];
  const desktopPage = await openTerminal(desktop, [], opened);
  await expect(desktopPage.getByRole("navigation", { name: "Terminal controls" })).toHaveCount(0);
  await expect.poll(() => opened.length).toBe(1);
  expect(Number(new URL(opened[0]).searchParams.get("cols"))).toBeLessThanOrEqual(140);
  expect(await desktopPage.locator(".terminal-frame").evaluate((element) => element.getBoundingClientRect().width)).toBe(980);
  await desktop.close();
});
