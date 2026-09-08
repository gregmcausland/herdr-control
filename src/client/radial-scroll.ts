export const RADIAL_VISIBLE = 3;
export const RADIAL_STEP = 30;
export const RADIAL_CENTER = 328;

export function clampOffset(offset: number, count: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, count - RADIAL_VISIBLE)));
}

/** Angles increase from the left edge towards the top of the corner. */
export function radialPoint(angle: number, radius: number) {
  const radians = angle * Math.PI / 180;
  return { x: RADIAL_CENTER - radius * Math.cos(radians), y: RADIAL_CENTER - radius * Math.sin(radians) };
}

export function radialArc(start: number, end: number, radius = 288): string {
  const from = radialPoint(start, radius);
  const to = radialPoint(end, radius);
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
}

/** Unwrap the pointer angle, not the list. The list always stops at its ends. */
export function angleDelta(previous: number, current: number): number {
  return ((current - previous + 540) % 360) - 180;
}

export function radialWindow(count: number, offset: number, stretch = 0) {
  const bounded = clampOffset(offset, count);
  const start = Math.max(0, Math.floor(bounded) - 1);
  const end = Math.min(count, Math.ceil(bounded) + RADIAL_VISIBLE + 1);
  return Array.from({ length: end - start }, (_, slot) => {
    const index = start + slot;
    return { index, angle: 15 + (index - bounded - stretch) * RADIAL_STEP };
  });
}
