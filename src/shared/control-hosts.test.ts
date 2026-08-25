import { describe, expect, it } from "vitest";
import { normalizeControlHostUrl } from "./control-hosts";

describe("Control Host URLs", () => {
  it("normalizes host names and origins", () => {
    expect(normalizeControlHostUrl("server.example")).toBe("https://server.example");
    expect(normalizeControlHostUrl(" http://127.0.0.1:4173/ ")).toBe("http://127.0.0.1:4173");
  });

  it("rejects paths, credentials, and unsupported protocols", () => {
    expect(() => normalizeControlHostUrl("https://server.example/control")).toThrow(/origin/);
    expect(() => normalizeControlHostUrl("https://user:pass@server.example")).toThrow(/origin/);
    expect(() => normalizeControlHostUrl("file:///tmp/control")).toThrow(/origin/);
  });
});
