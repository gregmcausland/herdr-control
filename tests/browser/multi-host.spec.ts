import { expect, test } from "@playwright/test";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import type { ControlHost } from "../../src/shared/control-hosts";
import type { SessionFeedState, SessionSnapshot } from "../../src/shared/protocol";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

test("keeps one host usable while another disconnects and recovers", async ({ page }) => {
  let controlHosts: readonly ControlHost[] = [];
  const second = new FakeBridge("Second MZ", "Second project", () => [], false, ["pi"]);
  const secondUrl = await second.start();
  const home = new FakeBridge("Home MZ", "Home project", () => controlHosts, true, ["codex"]);
  const homeUrl = await home.start();
  controlHosts = [
    { label: "Home MZ", url: homeUrl },
    { label: "Second MZ", url: secondUrl },
  ];

  try {
    await page.goto(homeUrl);
    const homeStatus = page.locator(".host-status", { hasText: "Home MZ" });
    const secondStatus = page.locator(".host-status", { hasText: "Second MZ" });
    await expect(homeStatus).toHaveClass(/live/);
    await expect(secondStatus).toHaveClass(/live/);
    await expect(page.getByText("Home project", { exact: true })).toBeVisible();
    await expect(page.getByText("Second project", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("button", { name: "Go back" })).toBeVisible();
    expect(await settings.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    await settings.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "New Thread in Home project on Home MZ" }).click();
    const homeLauncher = page.getByRole("dialog", { name: "Choose an agent for Home project" });
    await expect(homeLauncher.getByRole("button", { name: "Codex", exact: true })).toBeVisible();
    await expect(homeLauncher.getByRole("button", { name: "Pi", exact: true })).toHaveCount(0);
    await homeLauncher.getByRole("button", { name: "Close agent menu" }).click();

    await page.getByRole("button", { name: "New Thread in Second project on Second MZ" }).click();
    const secondLauncher = page.getByRole("dialog", { name: "Choose an agent for Second project" });
    await expect(secondLauncher.getByRole("button", { name: "Pi", exact: true })).toBeVisible();
    await expect(secondLauncher.getByRole("button", { name: "Codex", exact: true })).toHaveCount(0);
    await secondLauncher.getByRole("button", { name: "Close agent menu" }).click();

    const secondPort = second.port;
    await second.stop();
    await expect(secondStatus).toHaveClass(/stale/);
    await expect(homeStatus).toHaveClass(/live/);
    await expect(page.getByText("Second project", { exact: true })).toBeVisible();
    await expect(page.locator(".notice.error")).toHaveCount(0);

    await second.start(secondPort);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(secondStatus).toHaveClass(/live/);
    await expect(homeStatus).toHaveClass(/live/);
  } finally {
    await second.stop();
    await home.stop();
  }
});

test("opens the mobile task composer through the agent fan", async ({ page }) => {
  let controlHosts: readonly ControlHost[] = [];
  const home = new FakeBridge("Mobile MZ", "Mobile project", () => controlHosts, true);
  const homeUrl = await home.start();
  controlHosts = [{ label: "Mobile MZ", url: homeUrl }];

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(homeUrl);
    await page.getByRole("button", { name: "New Thread in Mobile project on Mobile MZ" }).click();

    const launcher = page.getByRole("dialog", { name: "Choose an agent for Mobile project" });
    await expect(launcher).toBeVisible();
    await launcher.getByRole("button", { name: "Pi", exact: true }).click();

    const composer = page.getByRole("dialog", { name: "New thread" });
    await expect(composer.getByText("Mobile project", { exact: true })).toBeVisible();
    await expect(composer.getByLabel("What should Pi work on?")).toBeFocused();
    await expect(composer.getByRole("button", { name: "Go back" })).toBeVisible();
    await expect(composer).toHaveCSS("border-radius", "0px");
    expect(await composer.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(composer.getByRole("button", { name: /Pi · Project default/ })).toHaveAttribute("aria-expanded", "false");
    await expect(composer.getByLabel("Agent")).toHaveCount(0);

    await composer.getByRole("button", { name: /Pi · Project default/ }).click();
    await expect(composer.getByRole("combobox", { name: /Agent/ })).toHaveValue("pi");

    await composer.getByRole("button", { name: "Go back" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("button", { name: "Go back" })).toBeVisible();
    expect(await settings.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });

    await settings.getByRole("button", { name: "Go back" }).click();
    await page.getByRole("button", { name: "Manage servers" }).click();
    const hosts = page.getByRole("dialog", { name: "Servers" });
    expect(await hosts.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await hosts.getByRole("button", { name: "Edit Mobile MZ" }).click();
    await hosts.getByRole("button", { name: "Remove" }).click();
    const confirmation = page.getByRole("dialog", { name: "Remove Mobile MZ?" });
    const confirmationBox = await confirmation.boundingBox();
    expect(confirmationBox?.y).toBeGreaterThan(0);
    expect((confirmationBox?.y ?? 0) + (confirmationBox?.height ?? 0)).toBe(844);
  } finally {
    await home.stop();
  }
});

test("keeps inactive Projects in the picker without cluttering home", async ({ page }) => {
  let controlHosts: readonly ControlHost[] = [];
  const home = new FakeBridge(
    "Home MZ",
    "Active project",
    () => controlHosts,
    true,
    ["codex"],
    ["Dormant project"],
  );
  const homeUrl = await home.start();
  controlHosts = [{ label: "Home MZ", url: homeUrl }];

  try {
    await page.goto(homeUrl);
    await expect(page.getByText("Active project", { exact: true })).toBeVisible();
    await expect(page.getByText("Dormant project", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "All projects · 2", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose a project" });
    await expect(picker.getByText("Active project", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: /Dormant project/ }).click();

    await expect(page.getByRole("dialog", { name: "Choose an agent for Dormant project" })).toBeVisible();
  } finally {
    await home.stop();
  }
});

test("keeps project and thread positions stable as live agents finish", async ({ page }, testInfo) => {
  let controlHosts: readonly ControlHost[] = [];
  const home = new FakeBridge("Home MZ", "Zulu", () => controlHosts, true);
  const homeUrl = await home.start();
  controlHosts = [{ label: "Home MZ", url: homeUrl }];
  const state = snapshot("Home MZ", "Zulu", ["Alpha", "Dormant"]);
  const older = { ...state.panes[0], label: "Older working thread", thread_id: "older", agent_status: "working",
    working_started_at: new Date(Date.now() - 120_000).toISOString() };
  const newer = { ...older, pane_id: "newer-pane", label: "Newer idle thread", thread_id: "newer", agent_status: "idle", last_work_duration_ms: 123_000 };
  state.panes = [older, newer, { ...newer, pane_id: "alpha-pane", label: "Alpha thread", thread_id: "alpha", project_id: "alpha:project" }];
  state.threads = ["older", "newer", "alpha"].map((id, index) => ({
    thread_id: id, title: id, agent: "codex", lifecycle: "open",
    created_at: `2026-08-${20 + index}T12:00:00.000Z`, updated_at: "2026-09-05T12:00:00.000Z",
  }));
  home.publish(state);
  const titles = () => page.locator(".workspace-group:has(.pane-list) .workspace-divider > span:first-child");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(homeUrl);
    await expect(titles()).toHaveText(["Alpha", "Zulu"]);
    await expect(page.locator(".pane-copy strong")).toHaveText(["Alpha thread", "Newer idle thread", "Older working thread"]);
    await expect(page.locator(".pane-detail").nth(1)).toHaveText("Codex · Idle");
    await expect(page.locator(".pane-detail").nth(2)).toContainText("Working · 2m");
    await page.screenshot({ path: testInfo.outputPath("index-working.png") });
    older.agent_status = "done";
    state.panes.reverse();
    home.publish(state);
    await expect(page.locator(".pane-detail").nth(2)).toHaveText("Codex · Done");
    await expect(titles()).toHaveText(["Alpha", "Zulu"]);
    await expect(page.locator(".pane-copy strong")).toHaveText(["Alpha thread", "Newer idle thread", "Older working thread"]);
    await page.reload();
    await expect(page.locator(".pane-copy strong")).toHaveText(["Alpha thread", "Newer idle thread", "Older working thread"]);
    await page.screenshot({ path: testInfo.outputPath("index-finished.png") });
  } finally {
    await page.close();
    await home.stop();
  }
});

class FakeBridge {
  private readonly responses = new Set<ServerResponse>();
  private readonly server = createServer((request, response) => this.respond(request, response));
  private currentPort?: number;
  private state?: SessionFeedState;

  constructor(
    private readonly label: string,
    private readonly projectName: string,
    private readonly controlHosts: () => readonly ControlHost[] = () => [],
    private readonly serveClient = false,
    private readonly agents: readonly string[] = ["codex", "claude", "pi"],
    private readonly inactiveProjects: readonly string[] = [],
  ) {}

  get port(): number {
    if (!this.currentPort) throw new Error("Bridge is not listening");
    return this.currentPort;
  }

  publish(snapshot: SessionSnapshot): void {
    this.state = { status: "live", revision: (this.state?.revision ?? 0) + 1, snapshot };
    for (const response of this.responses) response.write(`data: ${JSON.stringify(this.state)}\n\n`);
  }

  async start(port = 0): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.currentPort = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${this.currentPort}`;
  }

  async stop(): Promise<void> {
    if (!this.server.listening) return;
    for (const response of this.responses) response.end();
    this.responses.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
      // A browser can reconnect SSE on an existing HTTP connection during teardown.
      this.server.closeAllConnections();
    });
  }

  private respond(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/control-hosts") {
      const timestamp = "2026-08-25T00:00:00.000Z";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        hosts: this.controlHosts().map((host, index) => ({
          ...host,
          host_id: `host-${index + 1}`,
          created_at: timestamp,
          updated_at: timestamp,
        })),
      }));
      return;
    }
    if (pathname === "/api/agents") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ agents: this.agents }));
      return;
    }
    if (pathname === "/api/session/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify(this.state ?? feedState(this.label, this.projectName, this.inactiveProjects))}\n\n`);
      this.responses.add(response);
      request.on("close", () => this.responses.delete(response));
      return;
    }
    if (pathname === "/api/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (this.serveClient) {
      serveBuiltClient(pathname, response);
      return;
    }
    response.writeHead(404).end();
  }
}

function feedState(label: string, projectName: string, inactiveProjects: readonly string[]): SessionFeedState {
  return { status: "live", revision: 1, snapshot: snapshot(label, projectName, inactiveProjects) };
}

function snapshot(label: string, projectName: string, inactiveProjects: readonly string[] = []): SessionSnapshot {
  const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const timestamp = "2026-08-25T00:00:00.000Z";
  return {
    version: "0.8.0",
    protocol: 20,
    workspaces: [{
      workspace_id: `${id}:w1`,
      label: projectName,
      number: 1,
      tab_count: 1,
      pane_count: 1,
      focused: true,
    }],
    tabs: [{
      tab_id: `${id}:t1`,
      workspace_id: `${id}:w1`,
      label: "Thread",
      number: 1,
      pane_count: 1,
      focused: true,
    }],
    panes: [{
      pane_id: `${id}:p1`,
      tab_id: `${id}:t1`,
      workspace_id: `${id}:w1`,
      terminal_id: `${id}:terminal-1`,
      label: `${label} thread`,
      project_id: `${id}:project`,
      agent: "codex",
      agent_status: "idle",
      focused: true,
    }],
    projects: [projectName, ...inactiveProjects].map((name, index) => {
      const projectId = index === 0 ? id : name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
      return {
        project_id: `${projectId}:project`,
        name,
        repo_key: `/${projectId}/.git`,
        repo_root: `/${projectId}`,
        created_at: timestamp,
        updated_at: timestamp,
      };
    }),
    worktrees: [],
    threads: [],
  };
}

function serveBuiltClient(pathname: string, response: ServerResponse): void {
  const root = resolve(process.cwd(), "dist/client");
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  const insideRoot = candidate === root || candidate.startsWith(`${root}${sep}`);
  const file = insideRoot && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : resolve(root, "index.html");
  response.writeHead(200, { "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}
