import { describe, expect, it } from "vitest";
import { configuredHosts, hostOptions, normalizeHost, resolveInitialHost } from "./hosts";

describe("Control hosts", () => {
  it("does not bundle personal machines into a new installation", () => {
    expect(configuredHosts).toEqual([]);
    expect(hostOptions("http://127.0.0.1:4173")).toEqual([{
      label: "Custom host",
      url: "http://127.0.0.1:4173",
    }]);
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
