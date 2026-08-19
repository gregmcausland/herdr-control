export interface ScrollBatch {
  direction: "up" | "down";
  lines: number;
  remainder: number;
}

/** Converts browser wheel units into terminal rows without coupling to a device's wheel resolution. */
export function wheelDeltaToLines(deltaY: number, deltaMode: number, viewportRows: number): number {
  if (deltaMode === 1) return deltaY;
  if (deltaMode === 2) return deltaY * viewportRows;
  return deltaY / 32;
}

/** Converts a direct-manipulation touch drag into terminal rows. */
export function touchDeltaToLines(deltaY: number, viewportHeight: number, viewportRows: number): number {
  const rowHeight = viewportHeight / viewportRows;
  return Number.isFinite(rowHeight) && rowHeight > 0 ? deltaY / rowHeight : 0;
}

/** Takes one bounded frame's work while preserving overflow for the next animation frame. */
export function takeScrollBatch(pendingLines: number, limit = 12): ScrollBatch | undefined {
  const wholeLines = Math.trunc(Math.abs(pendingLines));
  if (wholeLines === 0) return undefined;

  const lines = Math.min(wholeLines, limit);
  const sign = Math.sign(pendingLines);
  return {
    direction: sign < 0 ? "up" : "down",
    lines,
    remainder: pendingLines - sign * lines,
  };
}
