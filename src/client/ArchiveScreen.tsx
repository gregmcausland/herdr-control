import { ARCHIVE_RETENTION_DAYS } from "../shared/archive-policy";
import type { HostedArchivedThread } from "./hosted-projects";
import { TaskSurface } from "./Surface";

interface ArchivedThreadListProps {
  threads: readonly HostedArchivedThread[];
  restoringThreadKey?: string;
  showDate?: boolean;
  onRestore(thread: HostedArchivedThread): void;
}

export function ArchivedThreadList({
  threads,
  restoringThreadKey,
  showDate = false,
  onRestore,
}: ArchivedThreadListProps) {
  return (
    <div className="pane-list archived-list">
      {threads.map((archived) => {
        const { thread } = archived;
        return (
          <div className="archived-thread" key={archived.key}>
            <span className="archived-thread-icon" aria-hidden="true"><ArchiveIcon /></span>
            <span className="archived-thread-title">
              {thread.title}
              <small>{archived.host.label}</small>
              {showDate && <time dateTime={thread.archived_at ?? thread.updated_at}>{archiveDate(thread)}</time>}
            </span>
            {thread.agent_session && !thread.current_run && (
              <button
                className="secondary archived-restore"
                type="button"
                disabled={
                  archived.feedStatus !== "live"
                  || thread.restoring
                  || restoringThreadKey === archived.key
                }
                onClick={() => onRestore(archived)}
              >
                {thread.restoring || restoringThreadKey === archived.key ? "Restoring…" : "Restore"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ArchiveScreen({
  threads,
  restoringThreadKey,
  onRestore,
  onClose,
}: {
  threads: readonly HostedArchivedThread[];
  restoringThreadKey?: string;
  onRestore(thread: HostedArchivedThread): void;
  onClose(): void;
}) {
  return (
    <TaskSurface
      className="archive-screen"
      title="Archive"
      description={`Archived Threads remain restorable for ${ARCHIVE_RETENTION_DAYS} days.`}
      actions={<button className="surface-button secondary" type="button" onClick={onClose}>Close</button>}
      onClose={onClose}
    >
      {threads.length > 0
        ? (
            <ArchivedThreadList
              threads={threads}
              restoringThreadKey={restoringThreadKey}
              showDate
              onRestore={onRestore}
            />
          )
        : <p className="archive-empty">No archived Threads.</p>}
    </TaskSurface>
  );
}

export function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 7.5h16M6 7.5V19h12V7.5M9 11h6M5 4h14v3.5H5Z" />
    </svg>
  );
}

function archiveDate(thread: HostedArchivedThread["thread"]): string {
  const date = new Date(thread.archived_at ?? thread.updated_at);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
