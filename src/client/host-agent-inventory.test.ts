import { describe, expect, it, vi } from "vitest";
import { requestHostAgents } from "./host-agent-inventory";

describe("host agent inventory", () => {
  it("accepts and de-duplicates known agents", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ agents: ["pi", "codex", "pi"] })));

    await expect(requestHostAgents("https://server.example", undefined, request)).resolves.toEqual(["pi", "codex"]);
    expect(request).toHaveBeenCalledWith("https://server.example/api/agents", { signal: undefined });
  });

  it("rejects an inventory containing unsupported agent kinds", async () => {
    const request = async () => new Response(JSON.stringify({ agents: ["codex", "imaginary"] }));

    await expect(requestHostAgents("https://server.example", undefined, request))
      .rejects.toThrow("invalid agent inventory");
  });

  it("keeps an older bridge usable until it gains the inventory endpoint", async () => {
    const request = async () => new Response(undefined, { status: 404 });

    await expect(requestHostAgents("https://older.example", undefined, request)).resolves.toEqual([
      "codex",
      "claude",
      "gemini",
      "pi",
      "opencode",
    ]);
  });
});
