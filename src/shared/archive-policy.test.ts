import { describe, expect, it } from "vitest";
import type { ThreadInfo } from "./protocol";
import { isRecentArchive, RECENT_ARCHIVE_DAYS } from "./archive-policy";

describe("archive policy", () => {
  it("keeps seven days on the main screen and retains thirty days overall", () => {
    expect(RECENT_ARCHIVE_DAYS).toBe(7);
    expect(isRecentArchive(thread("2026-08-22T12:00:01.000Z"), Date.parse("2026-08-29T12:00:00.000Z"))).toBe(true);
    expect(isRecentArchive(thread("2026-08-22T12:00:00.000Z"), Date.parse("2026-08-29T12:00:00.000Z"))).toBe(false);
  });
});

function thread(archivedAt: string): ThreadInfo {
  return {
    thread_id: "thread-1",
    title: "Archived work",
    agent: "codex",
    lifecycle: "archived",
    created_at: archivedAt,
    updated_at: archivedAt,
    archived_at: archivedAt,
  };
}
