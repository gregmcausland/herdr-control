import { expect, test, type Page } from "@playwright/test";

const client = process.env.HERDR_CONTROL_TEST_CLIENT;
const project = { project_id: "project-1", name: "Phone project", repo_key: "/repo/.git", repo_root: "/repo", created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z" };
const snapshot = { version: "test", protocol: 20, workspaces: [], tabs: [], panes: [], threads: [], projects: [project], worktrees: [{ worktree_id: "worktree-1", project_id: project.project_id, label: "A long branch", branch: "feature/" + "long-name-".repeat(20), checkout_path: "/repo/worktrees/" + "long-path/".repeat(20) }] };

async function openForm(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    (window as any).creationFeeds = [];
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL) { super(url); (window as any).creationFeeds.push(this); }
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
  await expect(form.locator('input[value="project"]')).toBeFocused();
  await expect(form.locator("textarea")).toHaveCount(0);
  await expect(form.getByLabel("Title", { exact: true })).toHaveCount(0);
  return form;
}

test("keeps the form and actions inside the visible keyboard viewport", async ({ page }) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  const form = await openForm(page);
  await expect(form.getByRole("radio", { name: /New worktree/ })).toBeVisible();
  await form.getByRole("radio", { name: /Open another checkout/ }).check();
  await expect(form.getByRole("button", { name: "Start Thread" })).toBeDisabled();
  await expect(form.getByRole("status")).toContainText("Enter a checkout path");
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
  await form.getByRole("radio", { name: /New worktree/ }).check();
  const branch = form.getByLabel("Branch", { exact: false });
  await branch.fill("feature/phone-layout");
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect(branch).toBeDisabled();
  await expect(form.getByRole("button", { name: /Agent settings/ })).toBeDisabled();
  await form.locator("form").evaluate(el => el.requestSubmit());
  expect(requests).toHaveLength(1);
  finish();
  await expect(form.getByRole("status")).toHaveText("Unable to open that checkout");
  await expect(form.getByRole("status")).toBeInViewport();
  await expect(branch).toHaveValue("feature/phone-layout");
  await expect(branch).toBeEnabled();
  await expect(form.getByRole("button", { name: "Start Thread" })).toBeEnabled();
  expect(requests[0]).toEqual({ agent: "codex", location: { kind: "create_worktree", branch: "feature/phone-layout" } });
});

test("submits the selected agent and checkout and only closes on a valid launch acknowledgement", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const form = await openForm(page);
  let request: any;
  await page.route("**/api/projects/project-1/threads", route => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: { thread: { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", agent_name: "test" } } });
  });
  await form.getByRole("button", { name: /Agent settings/ }).click();
  await form.getByRole("combobox", { name: "Agent", exact: true }).selectOption("pi");
  await form.locator('input[value="worktree:worktree-1"]').check();
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/panes\/w1%3Ap2/);
  expect(request).toEqual({ agent: "pi", location: { kind: "worktree", worktree_id: "worktree-1" } });
  const sockets: string[] = [];
  await page.routeWebSocket(/\/api\/terminal/, socket => { sockets.push(socket.url()); socket.close(); });
  const pane = { pane_id: "w1:p2", tab_id: "w1:t2", workspace_id: "w1", terminal_id: "terminal-1", label: "Starting", focused: false };
  const publish = (next: unknown) => page.evaluate(snapshot => {
    for (const source of (window as any).creationFeeds) source.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ status: "live", revision: 2, snapshot }) }));
  }, next);
  await publish({ ...snapshot, panes: [pane] });
  await expect(page.getByRole("status")).toHaveText("Opening your conversation…");
  expect(sockets).toHaveLength(0);
  const thread = { thread_id: "new-thread", title: "Pi", agent: "pi", lifecycle: "open", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z", current_run: { ...pane, run_id: "run-1", agent_status: "idle" } };
  await page.route("**/api/threads/new-thread/conversation", route => route.fulfill({ json: { thread, messages: [], capture_available: true, has_older: false } }));
  await publish({ ...snapshot, panes: [{ ...pane, agent: "pi", thread_id: "new-thread" }], threads: [thread] });
  await expect(page).toHaveURL(/\/threads\/new-thread/);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
  expect(sockets).toHaveLength(0);
});


test("a new worktree can use generated defaults or an explicit branch and base", async ({ page }, info) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  const form = await openForm(page);
  await page.screenshot({ path: info.outputPath("checkout-phone.png") });
  await form.getByRole("radio", { name: /New worktree/ }).check();
  const requests: unknown[] = [];
  await page.route("**/api/projects/project-1/threads", route => { requests.push(route.request().postDataJSON()); return route.fulfill({ status: 502, json: { error: "Fixture keeps the form open" } }); });
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect(form.getByRole("status")).toHaveText("Fixture keeps the form open");
  expect(requests[0]).toEqual({ agent: "codex", location: { kind: "create_worktree" } });
  await form.getByLabel("Branch", { exact: false }).fill("feature/voice");
  await form.getByLabel("Start from", { exact: false }).fill("main");
  await page.screenshot({ path: info.outputPath("new-worktree-phone.png") });
  await form.getByRole("button", { name: "Start Thread" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ agent: "codex", location: { kind: "create_worktree", branch: "feature/voice", base: "main" } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("new-worktree-desktop.png") });
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("catppuccinLatte");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await openForm(page);
  await page.screenshot({ animations: "disabled", path: info.outputPath("checkout-light.png") });
});
