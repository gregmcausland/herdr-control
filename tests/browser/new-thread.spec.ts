import { expect, test, type Page } from "@playwright/test";

const client = process.env.HERDR_CONTROL_TEST_CLIENT;
const project = { project_id: "project-1", name: "Phone project", repo_key: "/repo/.git", repo_root: "/repo", created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z" };
const snapshot = { version: "test", protocol: 20, workspaces: [], tabs: [], panes: [], threads: [], projects: [project], worktrees: [{ worktree_id: "worktree-1", project_id: project.project_id, label: "A long branch", branch: "feature/" + "long-name-".repeat(20), checkout_path: "/repo/worktrees/" + "long-path/".repeat(20) }] };

async function openForm(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      set onerror(_listener: unknown) {}
      get onerror() { return null; }
    } as typeof EventSource;
  });
  // This fixture owns every API request. No live host is contacted.
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/control-hosts") return route.fulfill({ json: { hosts: [] } });
    if (path === "/api/agents") return route.fulfill({ json: { agents: ["codex", "pi"] } });
    if (path === "/api/session/events") return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ status: "live", revision: 1, snapshot })}\n\n` });
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture request" } });
  });
  await page.goto(client!);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  await page.getByRole("dialog", { name: "Choose a project" }).getByRole("button", { name: /Phone project/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Codex", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New thread", exact: true });
  await expect(form.getByLabel("What should Codex work on?")).toBeFocused();
  return form;
}

test("keeps the form and actions inside the visible keyboard viewport", async ({ page }) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  const form = await openForm(page);
  await form.getByRole("button", { name: /Options/ }).click();
  await expect(form.getByRole("combobox", { name: "Agent", exact: true })).toHaveJSProperty("tagName", "SELECT");
  await form.getByRole("combobox", { name: "Location", exact: true }).selectOption("open_worktree");
  await form.getByRole("button", { name: /Hide options/ }).click();
  await expect(form.getByRole("button", { name: "Start Thread" })).toBeDisabled();
  await expect(form.getByRole("status")).toContainText("Enter a checkout path");
  await form.getByRole("button", { name: /Options/ }).click();
  await form.getByLabel("Checkout path", { exact: true }).fill("/repo/checkout");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 380 });
    Object.defineProperty(window.visualViewport!, "offsetTop", { configurable: true, value: 70 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await form.boundingBox())?.height).toBe(380);
  const button = await form.getByRole("button", { name: "Start Thread" }).boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(450);
  await form.getByLabel("Checkout path", { exact: true }).scrollIntoViewIfNeeded();
  await expect(form.getByLabel("Checkout path", { exact: true })).toBeInViewport();
  await expect(form.getByLabel("Checkout path", { exact: true })).toHaveCSS("font-size", "16px");
  expect(await form.locator(".surface-body").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/new-thread-keyboard-fixed.png" });
});

test("freezes one launch request and keeps the draft with visible server errors", async ({ page }) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  const form = await openForm(page);
  const requests: unknown[] = [];
  let finish!: () => void;
  await page.route("**/api/projects/project-1/threads", async route => {
    requests.push(route.request().postDataJSON());
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ status: 502, json: { error: "Unable to open that checkout" } });
  });
  const prompt = form.getByLabel("What should Codex work on?");
  await prompt.fill("Investigate the phone layout");
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect(prompt).toBeDisabled();
  await expect(form.getByRole("button", { name: /Options/ })).toBeDisabled();
  await form.locator("form").evaluate(el => el.requestSubmit());
  expect(requests).toHaveLength(1);
  finish();
  await expect(form.getByRole("status")).toHaveText("Unable to open that checkout");
  await expect(form.getByRole("status")).toBeInViewport();
  await expect(prompt).toHaveValue("Investigate the phone layout");
  await expect(prompt).toBeEnabled();
  await expect(form.getByRole("button", { name: "Start Thread" })).toBeEnabled();
  expect(requests[0]).toMatchObject({ agent: "codex", prompt: "Investigate the phone layout", location: { kind: "project" } });
});

test("submits the selected agent and checkout and only closes on a valid launch acknowledgement", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const form = await openForm(page);
  let request: any;
  await page.route("**/api/projects/project-1/threads", route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { thread: { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_name: "test" } } });
  });
  await form.getByRole("button", { name: /Options/ }).click();
  await form.getByRole("combobox", { name: "Agent", exact: true }).selectOption("pi");
  await form.getByRole("combobox", { name: "Location", exact: true }).selectOption("worktree:worktree-1");
  await form.getByLabel("What should Pi work on?").fill("Review this checkout");
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/panes\/w1%3Ap2/);
  expect(request).toMatchObject({ agent: "pi", prompt: "Review this checkout", location: { kind: "worktree", worktree_id: "worktree-1" } });
});
