import { describe, expect, it } from "vitest";
import { advanceMotion, dragOrigin, releaseMotion, rubberBandOffset, type RadialMotion } from "./radial-motion";

function finish(motion: RadialMotion, count: number, fps = 60) {
  const positions = [motion.position];
  for (let frame = 0; frame < fps * 3 && !motion.done; frame++) {
    motion = advanceMotion(motion, 1 / fps, count);
    positions.push(motion.position);
  }
  expect(motion.done).toBe(true);
  return { motion, positions };
}

describe("radial touch motion", () => {
  it("coasts a little in the release direction and settles on an option at different refresh rates", () => {
    for (const fps of [60, 120]) {
      const { motion, positions } = finish(releaseMotion(5, 6, 30), 30, fps);
      expect(positions[1]).toBeGreaterThan(5);
      expect(motion.position).toBe(6);
      expect(Math.max(...positions)).toBeLessThan(6.2);
      expect(finish(releaseMotion(5, -6, 30), 30, fps).motion.position).toBe(4);
    }
  });

  it("resists pulls at both ends, remains bounded, and can be picked up without a jump", () => {
    expect(rubberBandOffset(4, 30)).toBe(4);
    for (const raw of [-.2, -4, 27.2, 31]) {
      const visual = rubberBandOffset(raw, 30);
      expect(visual).toBeGreaterThan(-.5);
      expect(visual).toBeLessThan(27.5);
      expect(rubberBandOffset(dragOrigin(visual, 30), 30)).toBeCloseTo(visual);
    }
    expect(Math.abs(rubberBandOffset(-.2, 30))).toBeLessThan(.2);
    const window = finish(releaseMotion(rubberBandOffset(-4, 30), 0, 30), 30);
    expect(window.motion.position).toBe(0);
    expect(window.positions.every(position => position <= 0)).toBe(true);
  });

  it("springs back from fast flings at either edge without cycling to the other end", () => {
    for (const [position, velocity, end] of [[0, -8, 0], [27, 8, 27]]) {
      const { motion, positions } = finish(releaseMotion(position, velocity, 30), 30);
      expect(motion.position).toBe(end);
      expect(Math.min(...positions)).toBeGreaterThan(-.5);
      expect(Math.max(...positions)).toBeLessThan(27.5);
    }
  });

  it("does not coast a resting finger, and leaves short lists still", () => {
    expect(finish(releaseMotion(5.15, 0, 30), 30).motion.position).toBe(5);
    for (const count of [0, 1, 2, 3]) expect(rubberBandOffset(10, count)).toBe(0);
  });
});
