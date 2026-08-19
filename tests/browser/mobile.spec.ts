import { expect, test } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;

test("fits the pane picker and terminal in a phone viewport", async ({ page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);

  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-picker.png", fullPage: true });

  await page.getByRole("button").filter({ hasText: paneId! }).click();
  await expect(page.locator(".terminal-header small")).toHaveText(new RegExp(`${paneId} · Control$`));
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("gregm@servermz");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".terminal-frame")!;
    const terminal = document.querySelector<HTMLElement>(".xterm")!;
    const frameBox = frame.getBoundingClientRect();
    const terminalBox = terminal.getBoundingClientRect();
    const style = getComputedStyle(frame);
    return {
      bottomGap: frameBox.bottom - terminalBox.bottom,
      rightGap: frameBox.right - terminalBox.right,
      expectedBottomGap: Number.parseFloat(style.paddingBottom),
      expectedRightGap: Number.parseFloat(style.paddingRight),
    };
  })).toMatchObject({ bottomGap: 20, rightGap: 14, expectedBottomGap: 20, expectedRightGap: 14 });
  await page.screenshot({ path: "test-results/mobile-terminal.png", fullPage: true });
});
