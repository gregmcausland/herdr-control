import { expect, test } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;

const snapshot = {
  protocol: 19,
  version: "0.8.0",
  captured_at: "2026-08-19T00:00:00Z",
  workspaces: [],
  tabs: [],
  panes: [],
};

const terminalSnapshot = {
  ...snapshot,
  workspaces: [{ workspace_id: "w1", label: "Test", number: 1, tab_count: 1, pane_count: 1, focused: true }],
  tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Test", number: 1, pane_count: 1, focused: true }],
  panes: [{
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term-test",
    terminal_title_stripped: "Theme test",
    cwd: "/tmp",
    agent: "codex",
    agent_status: "idle",
    thread_id: "thread-test",
    run_id: "run-test",
    focused: true,
  }],
  threads: [{
    thread_id: "thread-test",
    title: "Theme test",
    agent: "codex",
    lifecycle: "open",
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    current_run: {
      run_id: "run-test",
      workspace_id: "w1",
      workspace_label: "Test",
      tab_id: "w1:t1",
      pane_id: "w1:p1",
      terminal_id: "term-test",
      agent_status: "idle",
      started_at: "2026-08-20T00:00:00.000Z",
    },
  }],
};

test("applies and remembers settings for appearance and new threads", async ({ page }) => {
  test.skip(!clientUrl, "Built client endpoint is not present");
  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect.poll(() => settingsPalette(page)).toEqual({
    colorScheme: "dark",
    dialog: "rgb(33, 34, 44)",
    field: "rgb(52, 55, 70)",
    accent: "rgb(215, 255, 100)",
  });
  await page.getByLabel("Theme").selectOption("catppuccinLatte");
  await page.getByLabel("Default agent").selectOption("pi");
  await page.getByLabel("Skip permission prompts by default").check();
  await page.getByLabel("App text size").fill("17");
  await page.getByLabel("Terminal text size").fill("16");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => page.evaluate(() => ({
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--color-canvas"),
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--font-size-interface"),
    activityVeil: getComputedStyle(document.documentElement).getPropertyValue("--color-activity-veil"),
    browserChrome: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  }))).toEqual({
    canvas: "#eff1f5",
    fontSize: "17px",
    activityVeil: "#dce0e8",
    browserChrome: "#eff1f5",
  });

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Theme")).toHaveValue("catppuccinLatte");
  await expect(page.getByLabel("Default agent")).toHaveValue("pi");
  await expect(page.getByLabel("Skip permission prompts by default")).toBeChecked();
  await expect(page.getByLabel("Terminal text size")).toHaveValue("16");
  await expect.poll(() => settingsPalette(page)).toEqual({
    colorScheme: "light",
    dialog: "rgb(230, 233, 239)",
    field: "rgb(204, 208, 218)",
    accent: "rgb(215, 255, 100)",
  });
});

async function settingsPalette(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    dialog: getComputedStyle(document.querySelector(".settings-dialog")!).backgroundColor,
    field: getComputedStyle(document.querySelector(".settings-fields select")!).backgroundColor,
    accent: getComputedStyle(document.querySelector(".settings-footer button[type='submit']")!).backgroundColor,
  }));
}

test("adapts agent-owned dark true-colour surfaces for a light terminal", async ({ page }) => {
  test.skip(!clientUrl, "Built client endpoint is not present");
  await page.addInitScript(() => localStorage.setItem("herdr-control-theme", "solarizedLight"));
  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot: terminalSnapshot })}\n\n`,
  }));
  await page.routeWebSocket("**/api/terminal**", (socket) => {
    const escape = String.fromCharCode(27);
    const ansi = [
      `${escape}[2J${escape}[H`,
      `${escape}[38;2;147;153;178;48;2;49;49;49mCodex surface${escape}[0m\r\n`,
      `${escape}[38;2;212;212;212;48;2;40;50;40mPi surface${escape}[0m`,
    ].join("");
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
    socket.send(JSON.stringify({
      type: "frame",
      seq: 1,
      cols: 80,
      rows: 20,
      full: true,
      data: Buffer.from(ansi).toString("base64"),
    }));
  });

  await page.goto(`${clientUrl}/threads/thread-test?host=${encodeURIComponent(clientUrl!)}`);
  await expect(page.locator(".xterm-rows")).toContainText("Codex surface");
  const backgrounds = await page.locator(".xterm-rows span").evaluateAll((spans) => spans
    .filter((span) => span.textContent?.includes("surface"))
    .map((span) => getComputedStyle(span).backgroundColor));

  expect(backgrounds).toHaveLength(2);
  expect(backgrounds).not.toContain("rgb(49, 49, 49)");
  expect(backgrounds).not.toContain("rgb(40, 50, 40)");
  for (const background of backgrounds) {
    const channels = background.match(/\d+/g)?.map(Number) ?? [];
    expect(Math.min(...channels.slice(0, 3))).toBeGreaterThan(190);
  }
});
