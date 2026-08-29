import { describe, expect, it, vi } from "vitest";
import { discoverAvailableAgentKinds } from "./agent-discovery";

describe("agent discovery", () => {
  it("returns only Control-supported executables present on the host", async () => {
    const probe = vi.fn(async (executable: string) => ["codex", "pi"].includes(executable));

    await expect(discoverAvailableAgentKinds(probe)).resolves.toEqual(["codex", "pi"]);
    expect(probe).toHaveBeenCalledTimes(5);
  });

  it("treats a failed executable check as unavailable", async () => {
    const probe = async (executable: string) => {
      if (executable === "claude") throw new Error("PATH unavailable");
      return executable === "codex";
    };

    await expect(discoverAvailableAgentKinds(probe)).resolves.toEqual(["codex"]);
  });
});
