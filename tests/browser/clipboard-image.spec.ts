import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;
const run = promisify(execFile);

test("stages a pasted clipboard image and pastes its server path", async ({ page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(clientUrl!).origin,
  });
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await page.getByRole("button").filter({ hasText: paneId! }).click();
  await expect(page.locator(".terminal-header small")).toHaveText(new RegExp(`${paneId} · Control$`));

  const input = page.locator(".xterm-helper-textarea");
  const marker = `__CLIPBOARD_IMAGE_${Date.now()}__`;
  await input.focus();
  await page.keyboard.type("test -f ");

  const upload = page.waitForResponse((response) => (
    response.url().endsWith("/api/clipboard-image") && response.request().method() === "POST"
  ));
  await page.evaluate(async () => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
      (character) => character.charCodeAt(0),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([
      png,
    ], { type: "image/png" }) })]);
  });
  await page.keyboard.press("Control+V");

  const response = await upload;
  expect(response.status()).toBe(201);
  const { path } = await response.json() as { path: string };
  await expect.poll(async () => (await run("test", ["-f", path])).stderr).toBe("");

  await expect(page.locator(".terminal-header small")).toHaveText(new RegExp(`${paneId} · Control$`));
  await page.keyboard.type(` && printf '${marker}\\n'`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (
    await run("herdr", ["pane", "read", paneId!, "--source", "recent-unwrapped", "--lines", "20"])
  ).stdout).toContain(marker);

  const textMarker = `__CLIPBOARD_TEXT_${Date.now()}__`;
  await page.evaluate((text) => navigator.clipboard.writeText(text), `printf '${textMarker}\\n'`);
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (
    await run("herdr", ["pane", "read", paneId!, "--source", "recent-unwrapped", "--lines", "20"])
  ).stdout).toContain(textMarker);
});
