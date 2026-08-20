import { describe, expect, it } from "vitest";
import type { PaneInfo } from "../shared/protocol";
import { formatDuration, workingDuration } from "./working-duration";

const pane: PaneInfo = {
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  terminal_id: "term-1",
  focused: false,
};

describe("working duration", () => {
  it("shows a live working period and freezes its completed duration", () => {
    expect(workingDuration({
      ...pane,
      agent_status: "working",
      working_started_at: "2026-08-20T12:00:00.000Z",
    }, Date.parse("2026-08-20T12:01:12.000Z"))).toBe("1m 12s");

    expect(workingDuration({
      ...pane,
      agent_status: "done",
      last_work_duration_ms: 72_000,
    }, Date.parse("2026-08-20T13:00:00.000Z"))).toBe("1m 12s");
  });

  it("keeps longer durations compact", () => {
    expect(formatDuration(3_845_000)).toBe("1h 4m");
    expect(formatDuration(93_600_000)).toBe("1d 2h");
  });
});
