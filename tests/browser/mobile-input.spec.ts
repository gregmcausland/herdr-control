import { expect, test, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;

const snapshot = {
  version: "test",
  protocol: 19,
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
  }, {
    thread_id: "thread-recent",
    title: "Recent archived thread",
    agent: "codex",
    agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "recent-session" },
    lifecycle: "archived",
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    archived_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  }, {
    thread_id: "thread-older",
    title: "Older archived thread",
    agent: "codex",
    agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "older-session" },
    lifecycle: "archived",
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    archived_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  }],
};

async function mockTerminal(
  page: Page,
  sent: Array<{ type: string; data?: string; key?: string }>,
  opened: string[] = [],
  connections: WebSocketRoute[] = [],
  sessionConnections: string[] = [],
) {
  await page.route("**/api/session/events", (route) => {
    sessionConnections.push(route.request().url());
    return route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
    });
  });
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    opened.push(socket.url());
    connections.push(socket);
    socket.onMessage((message) => {
      const parsed = JSON.parse(message.toString()) as { type: string; data?: string; key?: string };
      sent.push(parsed);
      if (parsed.type === "release") socket.send(JSON.stringify({ type: "released" }));
      if (parsed.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    });
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
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/threads/thread-test/terminal");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  return page;
}

async function setPageVisibility(
  page: Page,
  visibility: DocumentVisibilityState,
  dispatch = true,
) {
  await page.evaluate(({ nextVisibility, shouldDispatch }) => {
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
    if (shouldDispatch) document.dispatchEvent(new Event("visibilitychange"));
  }, { nextVisibility: visibility, shouldDispatch: dispatch });
}

test("restores a routed terminal after refresh and follows browser history", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  await mockTerminal(page, []);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);

  await page.reload();
  await expect(page.locator(".terminal-heading strong")).toHaveText("Test pane");
  await page.goBack();
  await expect(page.getByRole("button", { name: "Open Test pane on Custom host" })).toBeVisible();
});

test("shows recent archive history on the main screen and all retained Threads in the archive", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  await mockTerminal(page, []);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);

  await expect(page.locator(".archived-thread-title", { hasText: "Recent archived thread" })).toBeVisible();
  await expect(page.locator(".archived-thread-title", { hasText: "Older archived thread" })).toHaveCount(0);
  await page.getByRole("button", { name: "View archive" }).click();

  const archive = page.getByRole("dialog", { name: "Archive" });
  await expect(archive.locator(".archived-thread-title", { hasText: "Recent archived thread" })).toBeVisible();
  await expect(archive.locator(".archived-thread-title", { hasText: "Older archived thread" })).toBeVisible();
  expect(await archive.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  await page.screenshot({ path: "test-results/archive-screen.png", fullPage: true });
});

test("reclaims uncontested control when returning to a backgrounded terminal", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const sent: Array<{ type: string }> = [];
  const opened: string[] = [];
  await mockTerminal(page, sent, opened);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect.poll(() => opened.length).toBe(1);

  await setPageVisibility(page, "hidden");
  await expect.poll(() => sent.some((message) => message.type === "release")).toBe(true);
  await setPageVisibility(page, "visible");

  await expect.poll(() => opened.length).toBe(2);
  expect(new URL(opened[1]).searchParams.get("takeover")).toBe("false");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
});

test("waits for Herdr release before reacquiring control", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const opened: string[] = [];
  let owner = false;

  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    opened.push(socket.url());
    if (owner) {
      socket.send(JSON.stringify({ type: "occupied", message: "already attached" }));
      return;
    }
    owner = true;
    socket.onMessage((message) => {
      const parsed = JSON.parse(message.toString()) as { type: string };
      if (parsed.type !== "release") return;
      setTimeout(() => {
        owner = false;
        socket.send(JSON.stringify({ type: "released" }));
      }, 150);
    });
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  await setPageVisibility(page, "hidden");
  await setPageVisibility(page, "visible");
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new Event("online"));
  });
  await page.waitForTimeout(50);
  expect(opened).toHaveLength(1);

  await expect.poll(() => opened.length).toBe(2);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
});

test("resumes after mobile pagehide and an ordinary pageshow", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const opened: string[] = [];
  await mockTerminal(page, [], opened);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
  });

  await expect.poll(() => opened.length).toBe(2);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
});

test("always offers manual recovery from a background release", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const opened: string[] = [];
  await mockTerminal(page, [], opened);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));

  await expect(page.locator(".terminal-header small")).toHaveText("Control released while app was in background");
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => opened.length).toBe(2);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
});

test("recovers when refresh overlaps the previous page's release", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  let owner = false;
  let releaseRequested = false;
  let cleanupScheduled = false;
  let connections = 0;

  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    connections += 1;
    if (owner) {
      socket.send(JSON.stringify({ type: "occupied", message: "old page still attached" }));
      if (releaseRequested && !cleanupScheduled) {
        cleanupScheduled = true;
        setTimeout(() => { owner = false; }, 150);
      }
      return;
    }

    owner = true;
    const scheduleRelease = () => {
      releaseRequested = true;
    };
    socket.onMessage((message) => {
      const parsed = JSON.parse(message.toString()) as { type: string };
      if (parsed.type === "release") scheduleRelease();
    });
    socket.onClose(scheduleRelease);
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  await page.reload();

  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
  expect(connections).toBeGreaterThanOrEqual(3);
});

test("replaces connections left open by mobile suspension", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const sent: Array<{ type: string }> = [];
  const opened: string[] = [];
  const sessionConnections: string[] = [];
  await mockTerminal(page, sent, opened, [], sessionConnections);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect.poll(() => opened.length).toBe(1);
  const feedsBeforeResume = sessionConnections.length;

  // Mobile browsers can freeze the page before its hidden event runs. The old
  // WebSocket then still reports OPEN when the visible event arrives.
  await setPageVisibility(page, "hidden", false);
  await setPageVisibility(page, "visible");

  await expect.poll(() => sent.some((message) => message.type === "release")).toBe(true);
  await expect.poll(() => opened.length).toBe(2);
  await expect.poll(() => sessionConnections.length).toBeGreaterThan(feedsBeforeResume);
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
});

test("reclaims uncontested control after the terminal bridge disconnects", async ({ page }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const opened: string[] = [];
  const connections: WebSocketRoute[] = [];
  await mockTerminal(page, [], opened, connections);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.goto(`${clientUrl}/threads/thread-test/terminal?host=${encodeURIComponent(clientUrl!)}`);
  await expect.poll(() => connections.length).toBe(1);

  await connections[0].close({ code: 1012, reason: "Bridge restarted" });

  await expect.poll(() => connections.length).toBe(2);
  expect(new URL(opened[1]).searchParams.get("takeover")).toBe("false");
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".terminal-overlay")).toHaveCount(0);
});

test("offers terminal keys on mobile without a second message composer", async ({ browser }) => {
  test.skip(!clientUrl, "A running browser client is required");
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const sent: Array<{ type: string; data?: string; key?: string }> = [];
  const page = await openTerminal(context, sent);
  await expect(page.getByRole("button", { name: "Message", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Keys", exact: true }).click();
  await page.getByRole("button", { name: "Esc", exact: true }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ type: "key", key: "esc" });
  await context.close();
});
