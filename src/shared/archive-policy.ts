import type { ThreadInfo } from "./protocol.js";

export const RECENT_ARCHIVE_DAYS = 7;
export const ARCHIVE_RETENTION_DAYS = 30;
export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export function isRecentArchive(thread: ThreadInfo, now = Date.now()): boolean {
  const archivedAt = Date.parse(thread.archived_at ?? thread.updated_at);
  return Number.isFinite(archivedAt) && now - archivedAt < RECENT_ARCHIVE_DAYS * 24 * 60 * 60 * 1_000;
}
