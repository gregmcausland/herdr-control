import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ControlHost, StoredControlHost } from "../shared/control-hosts";
import type { ControlHostConfiguration } from "./control-hosts";
import type { HostSessionFeed } from "./live-session";
import { ConfirmSurface, TaskSurface } from "./Surface";

type HostDraft = Pick<ControlHost, "label" | "url">;

export function ControlHostsDialog({
  configuration,
  liveState,
  onClose,
}: {
  configuration: ControlHostConfiguration;
  liveState: ReadonlyMap<
    string,
    Pick<HostSessionFeed, "status" | "message" | "snapshot">
  >;
  onClose(): void;
}) {
  const [drafts, setDrafts] = useState<Record<string, HostDraft>>(() =>
    draftsFor(configuration.storedHosts),
  );
  const [newHost, setNewHost] = useState<HostDraft>({ label: "", url: "" });
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [checks, setChecks] = useState<
    Record<string, { url: string; message: string } | undefined>
  >({});
  const checkResult = (key: string, url: string) =>
    checks[key]?.url === url ? checks[key]?.message : undefined;
  const [removeTarget, setRemoveTarget] = useState<StoredControlHost>();
  const [editing, setEditing] = useState<string>();
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    const key = returnFocus.current.dataset.editorKey ?? "new";
    const button =
      document.querySelector<HTMLButtonElement>(
        `[data-editor-key="${CSS.escape(key)}"]`,
      ) ?? document.querySelector<HTMLButtonElement>('[data-editor-key="new"]');
    button?.focus();
  }, [editing]);

  useEffect(
    () => setDrafts(draftsFor(configuration.storedHosts)),
    [configuration.storedHosts],
  );

  async function save(event: FormEvent, host?: StoredControlHost) {
    event.preventDefault();
    const key = host?.host_id ?? "new";
    const draft = host ? drafts[host.host_id] : newHost;
    if (!draft || pending || checkResult(key, draft.url) === "Checking…")
      return;
    setPending(key);
    setError(undefined);
    try {
      await configuration.save(host ? { ...host, ...draft } : draft);
      if (!host) setNewHost({ label: "", url: "" });
      setChecks((current) => ({ ...current, [key]: undefined }));
      setEditing(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save Control Host",
      );
    } finally {
      setPending(undefined);
    }
  }

  async function remove(host: StoredControlHost) {
    setPending(host.host_id);
    setError(undefined);
    try {
      await configuration.remove(host.host_id);
      setRemoveTarget(undefined);
      setEditing(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to remove Control Host",
      );
    } finally {
      setPending(undefined);
    }
  }

  async function check(host: ControlHost, key: string) {
    setChecks((current) => ({
      ...current,
      [key]: { url: host.url, message: "Checking…" },
    }));
    try {
      const url = /^https?:\/\//i.test(host.url.trim())
        ? host.url.trim()
        : `https://${host.url.trim()}`;
      const response = await fetch(new URL("/api/health", url), {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setChecks((current) => ({
        ...current,
        [key]: { url: host.url, message: "Reachable" },
      }));
    } catch (cause) {
      const message =
        cause instanceof Error && cause.name !== "TimeoutError"
          ? cause.message
          : "Timed out";
      setChecks((current) => ({
        ...current,
        [key]: { url: host.url, message: `Unavailable: ${message}` },
      }));
    }
  }

  const editable = configuration.status === "database";

  const hosts =
    configuration.storedHosts.length || configuration.status !== "fallback"
      ? configuration.storedHosts
      : configuration.hosts;

  function openEditor(key: string, button: HTMLButtonElement) {
    returnFocus.current = button;
    setError(undefined);
    setEditing(key);
  }

  function cancelEdit() {
    setDrafts(draftsFor(configuration.storedHosts));
    setNewHost({ label: "", url: "" });
    setError(undefined);
    setEditing(undefined);
  }

  const fields = (draft: HostDraft, update: (draft: HostDraft) => void) => (
    <div className="host-fields">
      <label>
        <span>Name</span>
        <input
          autoFocus
          required
          maxLength={120}
          disabled={
            Boolean(pending) ||
            checkResult(editing ?? "new", draft.url) === "Checking…"
          }
          placeholder="Server MZ"
          value={draft.label}
          onChange={(event) => update({ ...draft, label: event.target.value })}
        />
      </label>
      <label>
        <span>Server URL</span>
        <input
          required
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={2048}
          disabled={
            Boolean(pending) ||
            checkResult(editing ?? "new", draft.url) === "Checking…"
          }
          placeholder="https://machine.example.ts.net"
          value={draft.url}
          onChange={(event) => {
            setChecks((current) => ({
              ...current,
              [editing ?? "new"]: undefined,
            }));
            update({ ...draft, url: event.target.value });
          }}
        />
      </label>
    </div>
  );

  return (
    <>
      <TaskSurface
        title="Servers"
        description="Your machines running Herdr."
        className="hosts-dialog preferences-screen"
        fitViewport
        busy={Boolean(pending)}
        onClose={onClose}
        actions={
          editing ? (
            <>
              <button
                className="surface-button secondary"
                type="button"
                disabled={Boolean(pending)}
                onClick={cancelEdit}
              >
                Cancel
              </button>
              <button
                className="surface-button primary"
                type="submit"
                form="server-editor"
                disabled={
                  Boolean(pending) ||
                  (editing === "new" &&
                    checkResult("new", newHost.url) === "Checking…")
                }
              >
                {pending
                  ? editing === "new"
                    ? "Adding…"
                    : "Saving…"
                  : editing === "new"
                    ? "Add server"
                    : "Save changes"}
              </button>
            </>
          ) : (
            <button
              className="surface-button secondary"
              type="button"
              onClick={onClose}
            >
              Done
            </button>
          )
        }
      >
        {configuration.status === "loading" && (
          <p className="surface-note" role="status">
            Loading servers…
          </p>
        )}
        {configuration.status === "fallback" && (
          <p className="surface-note host-notice" role="status">
            The saved server list is unavailable. Showing known servers until it
            reconnects. Editing is temporarily disabled.
          </p>
        )}
        {!editing && (
          <div className="host-list-toolbar">
            <span>
              {hosts.length} {hosts.length === 1 ? "server" : "servers"}
            </span>
            <button
              type="button"
              className="surface-button primary"
              data-editor-key="new"
              disabled={!editable || Boolean(pending) || editing !== undefined}
              onClick={(event) => openEditor("new", event.currentTarget)}
            >
              <span aria-hidden="true">+</span> Add server
            </button>
          </div>
        )}
        {editing === "new" && (
          <form
            id="server-editor"
            className="host-card host-editor"
            aria-label="Add server"
            onSubmit={(event) => void save(event)}
          >
            <h3>Add a server</h3>
            {fields(newHost, setNewHost)}
            {error && (
              <p className="surface-error" role="alert">
                {error}
              </p>
            )}
            {checkResult("new", newHost.url) && (
              <p className="host-check-result" role="status">
                {checkResult("new", newHost.url)}
              </p>
            )}
            <div className="host-editor-actions">
              <button
                className="surface-button secondary"
                type="button"
                disabled={
                  !newHost.url ||
                  Boolean(pending) ||
                  checkResult("new", newHost.url) === "Checking…"
                }
                onClick={() => void check(newHost, "new")}
              >
                Check connection
              </button>
            </div>
          </form>
        )}
        {!hosts.length &&
          editing !== "new" &&
          configuration.status === "database" && (
            <div className="hosts-empty">
              <HostsIcon />
              <h3>No saved servers</h3>
              <p>Add a machine to see its agents and threads here.</p>
            </div>
          )}
        <div className="host-editor-list">
          {hosts.map((host) => {
            const key = host.host_id ?? host.url;
            const stored = configuration.storedHosts.find(
              (candidate) => candidate.host_id === key,
            );
            const draft = drafts[key] ?? host;
            const feed = liveState.get(host.url);
            const status = feed?.status ?? "connecting";
            const expanded = editing === key && stored;
            return (
              <section className="host-card" key={key} aria-label={host.label}>
                <div className="host-card-heading">
                  <span className="host-symbol" aria-hidden="true">
                    <HostsIcon />
                  </span>
                  <h3>{host.label}</h3>
                  <span className={`connection-status ${status}`}>
                    {status === "live"
                      ? "Live"
                      : status === "stale"
                        ? "Offline"
                        : "Connecting"}
                  </span>
                </div>
                <p className="host-address">{host.url}</p>
                {expanded ? (
                  <form
                    id="server-editor"
                    className="host-editor"
                    aria-label={`Edit ${host.label}`}
                    onSubmit={(event) => void save(event, stored)}
                  >
                    {fields(draft, (next) =>
                      setDrafts((current) => ({ ...current, [key]: next })),
                    )}
                    {error && !removeTarget && (
                      <p className="surface-error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="host-editor-actions">
                      <button
                        className="surface-button secondary danger"
                        type="button"
                        disabled={Boolean(pending)}
                        onClick={() => {
                          setError(undefined);
                          setRemoveTarget(stored);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="host-card-actions">
                    <button
                      className="surface-button secondary"
                      type="button"
                      disabled={
                        Boolean(pending) ||
                        checkResult(key, host.url) === "Checking…"
                      }
                      onClick={() => void check(host, key)}
                    >
                      Check connection
                    </button>
                    <button
                      className="surface-button secondary"
                      type="button"
                      aria-label={`Edit ${host.label}`}
                      data-editor-key={key}
                      disabled={
                        !editable ||
                        !stored ||
                        Boolean(pending) ||
                        editing !== undefined ||
                        checkResult(key, host.url) === "Checking…"
                      }
                      onClick={(event) => openEditor(key, event.currentTarget)}
                    >
                      Edit
                    </button>
                  </div>
                )}
                {(checkResult(key, host.url) || feed?.message) && (
                  <p className="host-check-result" role="status">
                    {checkResult(key, host.url) ?? feed?.message}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </TaskSurface>

      {removeTarget && (
        <ConfirmSurface
          title={`Remove ${removeTarget.label}?`}
          message="It will disappear from Control. Its bridge and Herdr processes will keep running."
          confirmLabel="Remove"
          pendingLabel="Removing…"
          tone="destructive"
          error={error}
          busy={pending === removeTarget.host_id}
          onClose={() => {
            setError(undefined);
            setRemoveTarget(undefined);
          }}
          onConfirm={() => void remove(removeTarget)}
        />
      )}
    </>
  );
}

function draftsFor(
  hosts: readonly StoredControlHost[],
): Record<string, HostDraft> {
  return Object.fromEntries(
    hosts.map((host) => [host.host_id, { label: host.label, url: host.url }]),
  );
}

export function HostsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="6" rx="2" />
      <rect x="4" y="14" width="16" height="6" rx="2" />
      <path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" />
    </svg>
  );
}
