import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;
const agent = process.env.HERDR_CONTROL_TEST_AGENT;
const marker = process.env.HERDR_CONTROL_TEST_MARKER;
const prompt = process.env.HERDR_CONTROL_TEST_PROMPT;
const inputMode = process.env.HERDR_CONTROL_TEST_INPUT ?? "paste";
const run = promisify(execFile);

test("operates a native coding-agent TUI through xterm", async ({ page }) => {
  test.skip(
    !clientUrl || !bridgeUrl || !paneId || !agent || !marker || !prompt,
    "Live coding-agent compatibility configuration is not present",
  );
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await page.getByRole("button").filter({ hasText: paneId! }).click();
  await expect(page.locator(".terminal-header small")).toHaveText(new RegExp(`${paneId} · Control$`));

  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type("/");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  if (inputMode === "type") {
    await page.keyboard.type(prompt!, { delay: 1 });
  } else {
    await input.evaluate((element, text) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
    }, prompt!);
    // Native agent TUIs may briefly treat Enter as part of a paste burst.
    await page.waitForTimeout(100);
  }
  await page.keyboard.press("Enter");

  await expect.poll(async () => {
    try {
      const { stdout } = await run("herdr", ["agent", "read", agent!, "--source", "visible"]);
      return stdout;
    } catch {
      return "";
    }
  }, { timeout: 150_000, intervals: [500, 1_000, 2_000] }).toContain(marker);

  await expect.poll(() => errors).toEqual([]);
  await page.screenshot({ path: `test-results/${agent}-terminal.png`, fullPage: true });
});
