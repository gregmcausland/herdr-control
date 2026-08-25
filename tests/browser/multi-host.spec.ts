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
  const second = new FakeBridge("Second MZ", "Second project");
  const secondUrl = await second.start();
  const home = new FakeBridge("Home MZ", "Home project", () => controlHosts, true);
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

    const secondPort = second.port;
    await second.stop();
    await expect(secondStatus).toHaveClass(/stale/);
    await expect(homeStatus).toHaveClass(/live/);
    await expect(page.getByText("Second project", { exact: true })).toBeVisible();

    await second.start(secondPort);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(secondStatus).toHaveClass(/live/);
    await expect(homeStatus).toHaveClass(/live/);
  } finally {
    await second.stop();
    await home.stop();
  }
});

class FakeBridge {
  private readonly responses = new Set<ServerResponse>();
  private readonly server = createServer((request, response) => this.respond(request, response));
  private currentPort?: number;

  constructor(
    private readonly label: string,
    private readonly projectName: string,
    private readonly controlHosts: () => readonly ControlHost[] = () => [],
    private readonly serveClient = false,
  ) {}

  get port(): number {
    if (!this.currentPort) throw new Error("Bridge is not listening");
    return this.currentPort;
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
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
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
    if (pathname === "/api/session/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify(feedState(this.label, this.projectName))}\n\n`);
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

function feedState(label: string, projectName: string): SessionFeedState {
  return { status: "live", revision: 1, snapshot: snapshot(label, projectName) };
}

function snapshot(label: string, projectName: string): SessionSnapshot {
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
    projects: [{
      project_id: `${id}:project`,
      name: projectName,
      repo_key: `/${id}/.git`,
      repo_root: `/${id}`,
      created_at: timestamp,
      updated_at: timestamp,
    }],
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
