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

test("applies and remembers a selected app and terminal palette", async ({ page }) => {
  test.skip(!clientUrl, "Built client endpoint is not present");
  await page.route("**/api/session/events", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n`,
  }));

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(clientUrl!)}`);
  const selector = page.getByLabel("Theme");
  await expect(selector).toHaveValue("dracula");
  await selector.selectOption("catppuccinLatte");

  await expect.poll(() => page.evaluate(() => ({
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--color-canvas"),
    activityVeil: getComputedStyle(document.documentElement).getPropertyValue("--color-activity-veil"),
    browserChrome: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  }))).toEqual({ canvas: "#eff1f5", activityVeil: "#dce0e8", browserChrome: "#eff1f5" });

  await page.reload();
  await expect(page.getByLabel("Theme")).toHaveValue("catppuccinLatte");
});
