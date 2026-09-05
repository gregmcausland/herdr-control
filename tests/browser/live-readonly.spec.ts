import { expect, test } from "@playwright/test";

const home = process.env.HERDR_CONTROL_READONLY_URL;

test("reads conversations on every configured live host without controlling agents", async ({ page, context }, testInfo) => {
  test.skip(!home, "Set HERDR_CONTROL_READONLY_URL to explicitly inspect a deployed client");
  test.setTimeout(60_000);
  const blocked: string[] = [];
  const errors: string[] = [];
  await context.route("**/*", route => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
    blocked.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => {
    blocked.push(`WebSocket ${socket.url()}`);
    socket.close();
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(home!);
  await expect(page.locator(".host-status.live").first()).toBeVisible();
  const hostsResponse = await page.request.get(`${home}/api/control-hosts`);
  const { hosts } = await hostsResponse.json();
  expect(hosts.length).toBeGreaterThan(0);
  for (const host of hosts) {
    const snapshotResponse = await page.request.get(`${host.url}/api/snapshot`);
    expect(snapshotResponse.ok()).toBe(true);
    const snapshot = await snapshotResponse.json();
    const active = snapshot.threads?.find((thread: any) => thread.current_run);
    const archived = snapshot.threads?.find((thread: any) => !thread.current_run);
    expect(active ?? archived, `${host.label} needs a readable thread`).toBeTruthy();
    for (const thread of [active, archived].filter(Boolean)) {
      await page.goto(`${home}/threads/${thread.thread_id}?host=${encodeURIComponent(host.url)}`);
      await expect(page.locator(".conversation-header small")).toContainText(`${host.label} · Live ·`);
      await expect(page.locator(".conversation-reader .notice")).toHaveCount(0);
      await expect(page.locator(".message-error")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
      if (thread.current_run) await expect(page.getByRole("button", { name: "Open terminal", exact: true })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`${host.host_id}-${thread.current_run ? "active" : "archived"}.png`) });
      await page.reload();
      await expect(page.locator(".conversation-header small")).toContainText(`${host.label} · Live ·`);
      await expect(page.locator(".conversation-reader .notice")).toHaveCount(0);
      await expect(page.locator(".message-error")).toHaveCount(0);
    }
  }
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});
