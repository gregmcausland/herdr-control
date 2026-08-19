import { expect, test } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;

test("keeps the fitted terminal inside its padded desktop frame", async ({ page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await page.getByTitle(paneId!).click();
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  await expect(page.locator(".xterm-rows")).toContainText("gregm@servermz");

  const geometry = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".terminal-frame")!;
    const terminal = document.querySelector<HTMLElement>(".xterm")!;
    const frameBox = frame.getBoundingClientRect();
    const terminalBox = terminal.getBoundingClientRect();
    return {
      bottomGap: frameBox.bottom - terminalBox.bottom,
      rightGap: frameBox.right - terminalBox.right,
      terminalBottom: terminalBox.bottom,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });

  expect(geometry.bottomGap).toBeGreaterThanOrEqual(19);
  expect(geometry.rightGap).toBeGreaterThanOrEqual(19);
  expect(geometry.terminalBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  await page.screenshot({ path: "test-results/desktop-terminal.png", fullPage: true });
});
