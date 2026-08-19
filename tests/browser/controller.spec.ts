import { expect, test, type Page } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;

async function openPane(page: Page) {
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await expect(page.getByRole("heading", { name: "Herdr Control" })).toBeVisible();
  await page.getByTitle(paneId!).click();
}

test("hands writable control between browser clients explicitly", async ({ browser }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await openPane(first);
  await expect(first.locator(".terminal-header small")).toHaveText("Control");

  await openPane(second);
  await expect(second.getByText("Another browser or direct attach controls this pane.", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Observe" }).click();
  await expect(second.locator(".terminal-header small")).toHaveText("Observing");

  await second.getByRole("button", { name: "Control here" }).click();
  await expect(second.locator(".terminal-header small")).toHaveText("Control");
  await expect(first.getByText("terminal attach taken over", { exact: true })).toBeVisible();

  await second.getByRole("button", { name: "Release" }).click();
  await expect(second.getByText("Control released", { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Reconnect" }).click();
  await expect(second.locator(".terminal-header small")).toHaveText("Control");

  await firstContext.close();
  await secondContext.close();
});
