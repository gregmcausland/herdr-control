import { describe, expect, it } from "vitest";
import { angleDelta, clampOffset, radialWindow } from "./radial-scroll";

describe("finite radial scrolling", () => {
  it("stops at both ends without wrapping, including short and empty lists", () => {
    for (const count of [0, 1, 2, 3, 4, 10_000]) {
      expect(clampOffset(-10, count)).toBe(0);
      expect(clampOffset(20_000, count)).toBe(Math.max(0, count - 3));
      const end = radialWindow(count, 20_000);
      expect(end.every(item => item.index >= Math.max(0, count - 4) && item.index < count)).toBe(true);
      if (count >= 3) expect(end.at(-1)).toEqual({ index: count - 1, angle: 75 });
    }
  });

  it("renders only a small window and moves items continuously with the finger", () => {
    const window = radialWindow(10_000, 500.5);
    expect(window.length).toBeLessThanOrEqual(6);
    expect(window.find(item => item.index === 501)?.angle).toBe(30);
    expect(window.some(item => item.index === 0)).toBe(false);
  });

  it("unwraps pointer motion across the angle seam without jumping the list", () => {
    expect(angleDelta(179, -179)).toBe(2);
    expect(angleDelta(-179, 179)).toBe(-2);
    expect(angleDelta(75, 15)).toBe(-60);
  });
});
