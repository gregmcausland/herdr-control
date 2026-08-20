import { describe, expect, it } from "vitest";
import { HerdrAdapter, logicalKeyFromLegacyInput, resumeArgsFor, translateHerdrRecord } from "./herdr";
import { HerdrRequestError } from "./herdr-socket";

describe("Herdr terminal record translation", () => {
  it("hides Herdr's frame vocabulary behind the client interface", () => {
    expect(
      translateHerdrRecord({
        type: "terminal.frame",
        seq: 4,
        width: 120,
        height: 32,
        full: true,
        bytes: "G1sySg==",
      }),
    ).toEqual({
      type: "frame",
      seq: 4,
      cols: 120,
      rows: 32,
      full: true,
      data: "G1sySg==",
    });
  });

  it("reports a takeover as ownership contention", () => {
    expect(translateHerdrRecord({
      type: "terminal.closed",
      reason: "terminal attach taken over",
    })).toEqual({
      type: "occupied",
      message: "terminal attach taken over",
    });
  });

  it("turns controller contention into an actionable state", () => {
    expect(
      translateHerdrRecord({
        type: "terminal.closed",
        reason: "terminal already has an attached client; retry with --takeover",
      }),
    ).toEqual({
      type: "occupied",
      message: "terminal already has an attached client; retry with --takeover",
    });
  });
});

describe("legacy browser terminal input", () => {
  it("recovers navigation keys through Herdr's logical encoder", () => {
    expect(logicalKeyFromLegacyInput("\r")).toBe("enter");
    expect(logicalKeyFromLegacyInput("\x1b[B")).toBe("down");
    expect(logicalKeyFromLegacyInput("\x03")).toBe("ctrl+c");
  });

  it("leaves text input untouched", () => {
    expect(logicalKeyFromLegacyInput("hello")).toBeUndefined();
  });
});

describe("agent session restore commands", () => {
  it.each([
    ["codex", "id", "session-1", ["resume", "session-1"]],
    ["claude", "id", "session-2", ["--resume", "session-2"]],
    ["pi", "path", "/tmp/session.jsonl", ["--session", "/tmp/session.jsonl"]],
  ])("maps %s references to its native resume arguments", (agent, kind, value, expected) => {
    expect(resumeArgsFor(agent, { source: `herdr:${agent}`, agent, kind, value })).toEqual(expected);
  });
});

describe("archived pane retirement", () => {
  it("preserves panes protected by Herdr's worktree guard", async () => {
    const request = async () => {
      throw new HerdrRequestError("confirmation_required", "closing this pane would close a worktree group");
    };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await expect(herdr.retirePane("w1:p1")).resolves.toBe("retained");
  });

  it("does not hide unexpected pane retirement failures", async () => {
    const request = async () => { throw new Error("socket unavailable"); };
    const herdr = new HerdrAdapter("herdr", "/tmp/herdr.sock", request);

    await expect(herdr.retirePane("w1:p1")).rejects.toThrow("socket unavailable");
  });
});
