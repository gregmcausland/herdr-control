import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ControlHost, StoredControlHost } from "../shared/control-hosts";
import type { ControlHostConfiguration } from "./control-hosts";
import type { HostSessionFeed } from "./live-session";

type HostDraft = Pick<ControlHost, "label" | "url">;

export function ControlHostsDialog({
  configuration,
  liveState,
  onClose,
}: {
  configuration: ControlHostConfiguration;
  liveState: ReadonlyMap<string, Pick<HostSessionFeed, "status" | "message" | "snapshot">>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<Record<string, HostDraft>>(() => draftsFor(configuration.storedHosts));
  const [newHost, setNewHost] = useState<HostDraft>({ label: "", url: "" });
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [checks, setChecks] = useState<Record<string, string>>({});

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  useEffect(() => setDrafts(draftsFor(configuration.storedHosts)), [configuration.storedHosts]);

  async function save(event: FormEvent, host?: StoredControlHost) {
    event.preventDefault();
    const key = host?.host_id ?? "new";
    const draft = host ? drafts[host.host_id] : newHost;
    if (!draft) return;
    setPending(key);
    setError(undefined);
    try {
      await configuration.save(host ? { ...host, ...draft } : draft);
      if (!host) setNewHost({ label: "", url: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Control Host");
    } finally {
      setPending(undefined);
    }
  }

  async function remove(host: StoredControlHost) {
    if (!window.confirm(`Remove ${host.label} from Control? Its bridge and Herdr processes will keep running.`)) return;
    setPending(host.host_id);
    setError(undefined);
    try {
      await configuration.remove(host.host_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove Control Host");
    } finally {
      setPending(undefined);
    }
  }

  async function check(host: ControlHost) {
    const key = host.host_id ?? "new";
    setChecks((current) => ({ ...current, [key]: "Checking…" }));
    try {
      const url = /^https?:\/\//i.test(host.url.trim()) ? host.url.trim() : `https://${host.url.trim()}`;
      const response = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setChecks((current) => ({ ...current, [key]: "Reachable" }));
    } catch (cause) {
      const message = cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Timed out";
      setChecks((current) => ({ ...current, [key]: `Unavailable: ${message}` }));
    }
  }

  const editable = configuration.status === "database";

  return (
    <dialog
      ref={dialog}
      className="action-dialog hosts-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="action-dialog-content">
        <span className="action-dialog-icon hosts" aria-hidden="true"><HostsIcon /></span>
        <div>
          <h2>Control Hosts</h2>
          <p>Manage the Herdr machines shown by this Home bridge.</p>
        </div>
      </div>

      {configuration.status === "fallback" && (
        <p className="action-dialog-note">
          Using the bundled host list because database configuration could not load.
          Editing is disabled. {configuration.message}
        </p>
      )}
      {error && <p className="action-dialog-error">{error}</p>}

      <div className="host-editor-list">
        {configuration.storedHosts.map((host) => {
          const draft = drafts[host.host_id] ?? host;
          const feed = liveState.get(host.url);
          const status = feed?.status ?? "connecting";
          return (
            <form className="host-editor" key={host.host_id} onSubmit={(event) => void save(event, host)}>
              <div className="host-editor-heading">
                <span className={`connection-status ${status}`}>{status === "live" ? "Live" : status === "stale" ? "Offline" : "Connecting"}</span>
                {(checks[host.host_id] || feed?.message) && (
                  <small>{checks[host.host_id] ?? feed?.message}</small>
                )}
              </div>
              <label>
                <span>Name</span>
                <input
                  required
                  maxLength={120}
                  disabled={!editable || Boolean(pending)}
                  value={draft.label}
                  onChange={(event) => setDrafts({
                    ...drafts,
                    [host.host_id]: { ...draft, label: event.target.value },
                  })}
                />
              </label>
              <label>
                <span>Bridge URL</span>
                <input
                  required
                  inputMode="url"
                  maxLength={2_048}
                  disabled={!editable || Boolean(pending)}
                  value={draft.url}
                  onChange={(event) => setDrafts({
                    ...drafts,
                    [host.host_id]: { ...draft, url: event.target.value },
                  })}
                />
              </label>
              <div className="host-editor-actions">
                <button className="secondary" type="button" disabled={Boolean(pending)} onClick={() => void check(draft)}>
                  Check
                </button>
                <span />
                <button className="secondary danger" type="button" disabled={!editable || Boolean(pending)} onClick={() => void remove(host)}>
                  Remove
                </button>
                <button type="submit" disabled={!editable || Boolean(pending)}>
                  {pending === host.host_id ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          );
        })}

        <form className="host-editor new-host" onSubmit={(event) => void save(event)}>
          <div className="host-editor-heading"><strong>Add a Control Host</strong></div>
          <label>
            <span>Name</span>
            <input
              required
              maxLength={120}
              disabled={!editable || Boolean(pending)}
              placeholder="Server MZ"
              value={newHost.label}
              onChange={(event) => setNewHost({ ...newHost, label: event.target.value })}
            />
          </label>
          <label>
            <span>Bridge URL</span>
            <input
              required
              inputMode="url"
              maxLength={2_048}
              disabled={!editable || Boolean(pending)}
              placeholder="https://machine.example.ts.net"
              value={newHost.url}
              onChange={(event) => setNewHost({ ...newHost, url: event.target.value })}
            />
          </label>
          {checks.new && <small>{checks.new}</small>}
          <div className="host-editor-actions">
            <button className="secondary" type="button" disabled={!newHost.url || Boolean(pending)} onClick={() => void check(newHost)}>
              Check
            </button>
            <span />
            <button type="submit" disabled={!editable || Boolean(pending)}>
              {pending === "new" ? "Adding…" : "Add Host"}
            </button>
          </div>
        </form>
      </div>

      <footer>
        <button className="secondary" type="button" disabled={Boolean(pending)} onClick={onClose}>Close</button>
      </footer>
    </dialog>
  );
}

function draftsFor(hosts: readonly StoredControlHost[]): Record<string, HostDraft> {
  return Object.fromEntries(hosts.map((host) => [host.host_id, { label: host.label, url: host.url }]));
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
