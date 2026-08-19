import { describe, expect, it } from "vitest";
import { logicalKeyFromLegacyInput, translateHerdrRecord } from "./herdr";

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
