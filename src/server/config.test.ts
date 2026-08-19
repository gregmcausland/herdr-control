import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { isOriginAllowed, loadConfig } from "./config";

function request(origin: string | undefined, host = "servermz.example.ts.net"): IncomingMessage {
  return { headers: { origin, host } } as IncomingMessage;
}

describe("bridge configuration", () => {
  it("uses a localhost-only production default", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4173);
  });

  it("allows native clients, configured web clients, and same-origin clients", () => {
    const allowed = new Set(["http://localhost:5173"]);
    expect(isOriginAllowed(request(undefined), allowed)).toBe(true);
    expect(isOriginAllowed(request("http://localhost:5173"), allowed)).toBe(true);
    expect(isOriginAllowed(request("https://servermz.example.ts.net"), allowed)).toBe(true);
  });

  it("rejects an unrelated browser origin", () => {
    expect(isOriginAllowed(request("https://malicious.example", "servermz.example.ts.net"), new Set())).toBe(false);
  });
});
