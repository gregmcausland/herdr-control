import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const clientUrl = process.env.HERDR_CONTROL_TEST_CLIENT;
const bridgeUrl = process.env.HERDR_CONTROL_TEST_BRIDGE;
const paneId = process.env.HERDR_CONTROL_TEST_PANE;

test("opens plain and OSC 8 terminal links in a new tab", async ({ context, page }) => {
  test.skip(!clientUrl || !bridgeUrl || !paneId, "Live Herdr browser test configuration is not present");
  await context.route("https://example.com/**", (route) => route.fulfill({ body: "link opened" }));
  await page.goto(`${clientUrl}/?host=${encodeURIComponent(bridgeUrl!)}`);
  await page.getByTitle(paneId!).click();
  await expect(page.locator(".terminal-header small")).toHaveText("Control");

  const input = page.locator(".xterm-helper-textarea");
  await input.focus();
  await page.keyboard.type("printf '\\033[2J\\033[Hhttps://example.com/plain\\n'");
  await page.keyboard.press("Enter");
  await openLink(context, page, "https://example.com/plain");

  await input.focus();
  await page.keyboard.type("printf '\\033[2J\\033[H\\033]8;;https://example.com/osc8\\007OSC-link\\033]8;;\\007\\n'");
  await page.keyboard.press("Enter");
  await openLink(context, page, "OSC-link", "https://example.com/osc8");
});

async function openLink(
  context: BrowserContext,
  page: Page,
  text: string,
  expectedUrl = text,
): Promise<void> {
  const row = page.locator(".xterm-rows > div").filter({ hasText: text }).last();
  await expect(row).toContainText(text);
  const opened = context.waitForEvent("page");
  await row.hover({ position: { x: 6, y: 8 } });
  await row.click({ position: { x: 6, y: 8 } });
  const linkPage = await opened;
  await expect(linkPage).toHaveURL(expectedUrl);
  await linkPage.close();
}
