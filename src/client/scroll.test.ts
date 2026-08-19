import { describe, expect, it } from "vitest";
import { takeScrollBatch, touchDeltaToLines, wheelDeltaToLines } from "./scroll";

describe("terminal scroll batching", () => {
  it("normalizes pixel, line, and page wheel deltas", () => {
    expect(wheelDeltaToLines(64, 0, 24)).toBe(2);
    expect(wheelDeltaToLines(-3, 1, 24)).toBe(-3);
    expect(wheelDeltaToLines(1, 2, 24)).toBe(24);
  });

  it("caps each frame and carries remaining movement forward", () => {
    expect(takeScrollBatch(-30)).toEqual({ direction: "up", lines: 12, remainder: -18 });
    expect(takeScrollBatch(2.5)).toEqual({ direction: "down", lines: 2, remainder: 0.5 });
    expect(takeScrollBatch(0.5)).toBeUndefined();
  });

  it("maps direct touch movement to the visible terminal rows", () => {
    expect(touchDeltaToLines(40, 400, 20)).toBe(2);
    expect(touchDeltaToLines(-20, 400, 20)).toBe(-1);
    expect(touchDeltaToLines(20, 0, 20)).toBe(0);
  });
});
