import { describe, expect, it } from "vitest";
import { homePath, panePath, searchForHost, terminalRouteFromPath, threadPath } from "./routes";

describe("client routes", () => {
  it("round-trips Herdr pane IDs and preserves connection queries", () => {
    const path = panePath("w1:p12", "?host=https%3A%2F%2Fbridge.example");

    expect(path).toBe("/panes/w1%3Ap12?host=https%3A%2F%2Fbridge.example");
    expect(terminalRouteFromPath(new URL(path, "https://control.example").pathname)).toEqual({
      kind: "pane",
      id: "w1:p12",
    });
    expect(homePath("?host=https%3A%2F%2Fbridge.example")).toBe("/?host=https%3A%2F%2Fbridge.example");
  });

  it("gives durable Threads their own route", () => {
    const path = threadPath("thread-123");

    expect(path).toBe("/threads/thread-123");
    expect(terminalRouteFromPath(path)).toEqual({ kind: "thread", id: "thread-123" });
  });

  it("qualifies a terminal route with its owning host", () => {
    expect(searchForHost("https://alien.example", "?theme=dark&host=https%3A%2F%2Fold.example"))
      .toBe("?theme=dark&host=https%3A%2F%2Falien.example");
  });

  it("ignores unrelated and malformed pane routes", () => {
    expect(terminalRouteFromPath("/settings")).toBeUndefined();
    expect(terminalRouteFromPath("/panes/%E0%A4%A")).toBeUndefined();
    expect(terminalRouteFromPath("/panes/not%2Fa%2Fpane")).toBeUndefined();
  });
});
