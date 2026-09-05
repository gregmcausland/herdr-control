import { expect, test, type Page } from "@playwright/test";

const client = process.env.HERDR_CONTROL_TEST_CLIENT;
const stamp = "2026-09-05T00:00:00Z";
const initialHosts = [
  {
    host_id: "server",
    label: "Server MZ",
    url: "https://server.example.test",
    created_at: stamp,
    updated_at: stamp,
  },
  {
    host_id: "alien",
    label: "Alien MZ",
    url: "https://alien.example.test",
    created_at: stamp,
    updated_at: stamp,
  },
];

async function fixture(page: Page, empty = false) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      set onerror(_listener: unknown) {}
      get onerror() {
        return null;
      }
    } as typeof EventSource;
  });
  let hosts = empty ? [] : structuredClone(initialHosts);
  let fail = false;
  let delay: Promise<void> | undefined;
  await page.route("**/api/agents", (route) =>
    route.fulfill({ json: { agents: ["codex", "claude", "pi"] } }),
  );
  await page.route("**/api/session/events", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ status: route.request().url().includes("alien") ? "stale" : "live", revision: 1, snapshot: { protocol: 19, version: "test", workspaces: [], tabs: [], panes: [], threads: [] } })}\n\n`,
    }),
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );
  await page.route("**/api/control-hosts{,/*}", async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { hosts } });
    if (delay) await delay;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Server list unavailable. Please try again." },
      });
    const id = route.request().url().split("/").at(-1);
    if (method === "DELETE") {
      hosts = hosts.filter((host) => host.host_id !== id);
      return route.fulfill({ status: 204 });
    }
    const host = {
      ...route.request().postDataJSON(),
      host_id: method === "POST" ? "new-server" : id,
      created_at: stamp,
      updated_at: stamp,
    };
    hosts =
      method === "POST"
        ? [...hosts, host]
        : hosts.map((previous) => (previous.host_id === id ? host : previous));
    return route.fulfill({ json: { host } });
  });
  await page.goto(`${client}/?host=${encodeURIComponent(client!)}`);
  return {
    fail: (value: boolean) => {
      fail = value;
    },
    delay: (value?: Promise<void>) => {
      delay = value;
    },
  };
}

async function fits(page: Page) {
  expect(
    await page
      .locator(".preferences-screen")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(
    page.locator(".preferences-screen .surface-footer"),
  ).toBeInViewport();
}

test("settings preview stays local, custom fonts survive, and reset can be cancelled", async ({
  page,
}, info) => {
  test.skip(!client, "Browser client required");
  await fixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("settings-desktop.png"),
  });
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("catppuccinLatte");
  await expect(page.getByLabel("Appearance preview")).toHaveCSS(
    "background-color",
    "rgb(239, 241, 245)",
  );
  expect(
    await page.evaluate(() =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ),
  ).toBe("#282a36");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Theme", exact: true }),
  ).toHaveValue("dracula");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("settings-phone.png"),
  });
  await page
    .getByRole("group", { name: "New threads", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("settings-phone-defaults.png"),
  });
  await page
    .getByRole("combobox", { name: "App font", exact: true })
    .selectOption("custom");
  await page
    .getByLabel("Custom app font", { exact: true })
    .fill("Arial, sans-serif");
  await page.setViewportSize({ width: 320, height: 430 });
  await fits(page);
  await page
    .getByLabel("Custom app font", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("settings-keyboard.png"),
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Custom app font", { exact: true })).toHaveValue(
    "Arial, sans-serif",
  );
  await page
    .getByRole("button", { name: "Reset defaults", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Custom app font", { exact: true })).toHaveValue(
    "Arial, sans-serif",
  );
  await page
    .getByRole("combobox", { name: "Theme", exact: true })
    .selectOption("catppuccinLatte");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("settings-light.png"),
  });
});

test("server cards keep edits, checks and failed saves scoped to the right machine", async ({
  page,
}, info) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await page.getByRole("button", { name: "Manage servers" }).click();
  const server = page.getByRole("region", { name: "Server MZ", exact: true });
  const alien = page.getByRole("region", { name: "Alien MZ", exact: true });
  await expect(server).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("servers-desktop.png"),
  });
  await server.getByRole("button", { name: "Check connection" }).click();
  await expect(server.getByRole("status")).toHaveText("Reachable");
  await expect(alien.getByRole("status")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("servers-phone.png"),
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "herdr-control-settings",
      JSON.stringify({ theme: "catppuccinLatte" }),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "Manage servers" }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("servers-light.png"),
  });
  await server.getByRole("button", { name: "Edit Server MZ" }).click();
  await server.getByLabel("Name", { exact: true }).fill("Main server");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    server.getByRole("button", { name: "Edit Server MZ" }),
  ).toBeFocused();
  await server.getByRole("button", { name: "Edit Server MZ" }).click();
  await expect(server.getByLabel("Name", { exact: true })).toHaveValue(
    "Server MZ",
  );
  await server.getByLabel("Name", { exact: true }).fill("Main server");
  state.fail(true);
  let finish!: () => void;
  state.delay(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("server-saving.png"),
  });
  finish();
  state.delay();
  await expect(server.getByRole("alert")).toContainText("Please try again");
  await page.setViewportSize({ width: 320, height: 430 });
  await fits(page);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeInViewport();
  await server.getByLabel("Server URL").scrollIntoViewIfNeeded();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("server-edit-keyboard.png"),
  });
  state.fail(false);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const renamed = page.getByRole("region", {
    name: "Main server",
    exact: true,
  });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Edit Main server" }).click();
  await renamed.getByRole("button", { name: "Remove", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("server-remove.png"),
  });
  await page
    .getByRole("dialog", { name: "Remove Main server?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await renamed.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Remove Main server?" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(renamed).toHaveCount(0);
});

test("empty servers can be added and unavailable configuration stays readable", async ({
  page,
}, info) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, true);
  await page.getByRole("button", { name: "Manage servers" }).click();
  await expect(page.getByText("No saved servers")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("servers-empty.png"),
  });
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  const form = page.getByRole("form", { name: "Add server", exact: true });
  await form.getByLabel("Name", { exact: true }).fill("Studio");
  await form.getByLabel("Server URL").fill("https://studio.example.test");
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("server-add.png"),
  });
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Studio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.route("**/api/control-hosts", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline" } }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Manage servers" }).click();
  await expect(
    page.getByRole("button", { name: "Add server", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Studio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Studio", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: info.outputPath("servers-unavailable.png"),
  });
});
