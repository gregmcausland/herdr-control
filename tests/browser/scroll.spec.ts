import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;
const run = promisify(execFile);

async function scrollOffset(): Promise<number> {
  const { stdout } = await run("herdr", ["pane", "current", "--pane", paneId!]);
  const response = JSON.parse(stdout) as { result: { pane: { scroll: { offset_from_bottom: number } } } };
  return response.result.pane.scroll.offset_from_bottom;
}

test("forwards wheel and page-key scrolling to Herdr", async ({ page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await page.getByTitle(paneId!).click();
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type("for i in {1..120}; do echo SCROLL_$i; done");
  await page.keyboard.press("Enter");
  await expect.poll(scrollOffset).toBe(0);

  const terminal = page.locator(".terminal-host");
  const bounds = await terminal.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -640);
  await expect.poll(scrollOffset).toBeGreaterThan(0);

  await page.keyboard.press("PageDown");
  await page.mouse.wheel(0, 10_000);
  await expect.poll(scrollOffset).toBe(0);

  await page.keyboard.press("PageUp");
  await expect.poll(scrollOffset).toBeGreaterThan(0);
});
