import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;
const run = promisify(execFile);

test("selects and controls a live Herdr pane through xterm", async ({ page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await page.getByRole("button").filter({ hasText: paneId! }).click();
  await expect(page.locator(".terminal-header small")).toHaveText(new RegExp(`${paneId} · Control$`));
  await expect(page.locator(".xterm-screen")).toBeVisible();

  const input = page.locator(".xterm-helper-textarea");
  const readPane = async () => (await run("herdr", ["pane", "read", paneId!, "--source", "recent-unwrapped", "--lines", "40"])).stdout;
  await input.focus();

  const marker = `__BROWSER_XTERM_OK_${Date.now()}__`;
  await page.keyboard.type(`printf '${marker}\\n'`);
  await page.keyboard.press("Enter");
  await expect.poll(readPane).toContain(marker);

  await page.keyboard.type("echo AC");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("B");
  await page.keyboard.press("Enter");
  await expect.poll(readPane).toContain("ABC");

  await page.keyboard.type("cat /etc/hostn");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect.poll(readPane).toContain("cat /etc/hostname");

  const pasteA = `__PASTE_A_${Date.now()}__`;
  const pasteB = `__PASTE_B_${Date.now()}__`;
  await input.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, `printf '${pasteA}\\n'\nprintf '${pasteB}\\n'`);
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await expect.poll(readPane).toContain(pasteA);
  await expect.poll(readPane).toContain(pasteB);

  await page.keyboard.type("sleep 30");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+c");
  const recovered = `__AFTER_INTERRUPT_${Date.now()}__`;
  await page.keyboard.type(`printf '${recovered}\\n'`);
  await page.keyboard.press("Enter");
  await expect.poll(readPane).toContain(recovered);

  await expect.poll(() => errors).toEqual([]);
  await page.screenshot({ path: "test-results/live-terminal.png", fullPage: true });
});
