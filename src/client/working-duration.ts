import type { PaneInfo } from "../shared/protocol";

export function workingDuration(pane: PaneInfo, now: number): string | undefined {
  const duration = pane.agent_status === "working" && pane.working_started_at
    ? Math.max(0, now - Date.parse(pane.working_started_at))
    : pane.last_work_duration_ms;
  if (duration === undefined || !Number.isFinite(duration)) return undefined;
  return formatDuration(duration);
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
