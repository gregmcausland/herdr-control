import { describe, expect, it } from "vitest";
import { configuredHosts, hostOptions, normalizeHost, resolveInitialHost } from "./hosts";

describe("Control hosts", () => {
  it("keeps both Herdr machines in the saved host configuration", () => {
    expect(configuredHosts).toEqual([
      { label: "Server MZ", url: "https://servermz.tailb1d594.ts.net" },
      { label: "Alien MZ", url: "https://alienmz.tailb1d594.ts.net" },
    ]);
  });

  it("prefers a shared-link host and normalizes host names", () => {
    expect(resolveInitialHost("?host=alienmz", "https://stored.example", "https://control.example"))
      .toBe("https://alienmz");
    expect(normalizeHost("https://servermz.example/"))
      .toBe("https://servermz.example");
  });

  it("preserves an ad hoc development host as a selectable option", () => {
    expect(hostOptions("http://127.0.0.1:4173")[0]).toEqual({
      label: "Custom host",
      url: "http://127.0.0.1:4173",
    });
  });
});
