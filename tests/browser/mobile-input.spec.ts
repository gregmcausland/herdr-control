import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
    focused: true,
  }],
};

async function mockTerminal(page: Page, sent: Array<{ type: string; data?: string }>) {
  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    socket.onMessage((message) => sent.push(JSON.parse(message.toString())));
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });
}

async function openTerminal(context: BrowserContext, sent: Array<{ type: string; data?: string }>) {
  const page = await context.newPage();
  await mockTerminal(page, sent);
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button").filter({ hasText: "w1:p1" }).click();
  await expect(page.locator(".terminal-header small")).toHaveText("w1:p1 · Control");
  return page;
}

test("offers local message composition and terminal keys only on mobile", async ({ browser }) => {
  test.skip(!clientUrl, "A running browser client is required");

  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const sent: Array<{ type: string; data?: string }> = [];
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
    "\r",
  ]);
  await page.getByRole("button", { name: "Keys", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Terminal keys" })).toBeVisible();
  await page.getByRole("button", { name: "Esc", exact: true }).click();
  await expect.poll(() => sent.at(-1)?.data).toBe("\x1b");
  await expect(page.getByRole("dialog", { name: "Terminal keys" })).toBeVisible();
  await mobile.close();

  const desktop = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const desktopPage = await openTerminal(desktop, []);
  await expect(desktopPage.getByRole("navigation", { name: "Terminal controls" })).toHaveCount(0);
  await desktop.close();
});
