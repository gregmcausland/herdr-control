import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  ProjectInfo,
  ThreadCreationLocation,
  ThreadCreationRequest,
  WorktreeInfo,
} from "../shared/protocol";
import { AGENT_KINDS } from "./agent-catalog";

export function ThreadCreationDialog({
  project,
  worktrees,
  error,
  pending,
  defaultAgent,
  defaultSkipPermissions,
  onCancel,
  onCreate,
}: {
  project: ProjectInfo;
  worktrees: WorktreeInfo[];
  error?: string;
  pending: boolean;
  defaultAgent: string;
  defaultSkipPermissions: boolean;
  onCancel(): void;
  onCreate(request: ThreadCreationRequest): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [agent, setAgent] = useState(defaultAgent);
  const [skipPermissions, setSkipPermissions] = useState(defaultSkipPermissions);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [locationChoice, setLocationChoice] = useState("project");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [path, setPath] = useState("");
  const [worktreeLabel, setWorktreeLabel] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const location = creationLocation(locationChoice, { branch, base, path, label: worktreeLabel });
    onCreate({
      agent: agent.trim(),
      title: title.trim() || undefined,
      prompt: prompt.trim() || undefined,
      skip_permissions: skipPermissions && AGENT_KINDS.some((option) => option.kind === agent.trim()) || undefined,
      location,
    });
  }

  const creatingWorktree = locationChoice === "create_worktree";
  const openingWorktree = locationChoice === "open_worktree";
  const selectedAgent = AGENT_KINDS.find((option) => option.kind === agent.trim());

  return (
    <dialog
      ref={dialog}
      className="action-dialog creation-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form onSubmit={submit}>
        <div className="action-dialog-content">
          <span className="action-dialog-icon creation" aria-hidden="true"><PlusIcon /></span>
          <div>
            <h2>New thread</h2>
            <p>Start an agent in {project.name}. Herdr will give it a dedicated tab.</p>
          </div>
        </div>

        <div className="creation-fields">
          <label>
            <span>Agent</span>
            <AgentPicker value={agent} onChange={setAgent} />
          </label>

          <label className={`creation-toggle ${selectedAgent ? "" : "unavailable"}`}>
            <input
              type="checkbox"
              checked={skipPermissions && Boolean(selectedAgent)}
              disabled={!selectedAgent}
              onChange={(event) => setSkipPermissions(event.target.checked)}
            />
            <span>
              <strong>Skip permission prompts</strong>
              <small>
                {selectedAgent?.permissionHelp ?? "No permission-bypass launch mode is configured for this agent."}
              </small>
            </span>
          </label>

          <label>
            <span>Title <small>Optional</small></span>
            <input
              value={title}
              maxLength={200}
              placeholder="Derived from the first message"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label>
            <span>Location</span>
            <select value={locationChoice} onChange={(event) => setLocationChoice(event.target.value)}>
              <option value="project">Project default</option>
              {worktrees.map((worktree) => (
                <option value={`worktree:${worktree.worktree_id}`} key={worktree.worktree_id}>
                  {worktree.branch ?? worktree.label} — {worktree.checkout_path}
                </option>
              ))}
              <option value="create_worktree">Create a Worktree…</option>
              <option value="open_worktree">Open an existing Worktree…</option>
            </select>
          </label>

          {creatingWorktree && (
            <div className="creation-subfields">
              <label>
                <span>Branch <small>Optional</small></span>
                <input value={branch} placeholder="Herdr can generate one" onChange={(event) => setBranch(event.target.value)} />
              </label>
              <label>
                <span>Base <small>Optional</small></span>
                <input value={base} placeholder="Current HEAD" onChange={(event) => setBase(event.target.value)} />
              </label>
              <label>
                <span>Checkout path <small>Optional</small></span>
                <input value={path} placeholder="Managed by Herdr" onChange={(event) => setPath(event.target.value)} />
              </label>
              <label>
                <span>Label <small>Optional</small></span>
                <input value={worktreeLabel} onChange={(event) => setWorktreeLabel(event.target.value)} />
              </label>
            </div>
          )}

          {openingWorktree && (
            <div className="creation-subfields">
              <label>
                <span>Checkout path</span>
                <input value={path} required placeholder="/path/to/worktree" onChange={(event) => setPath(event.target.value)} />
              </label>
              <label>
                <span>Label <small>Optional</small></span>
                <input value={worktreeLabel} onChange={(event) => setWorktreeLabel(event.target.value)} />
              </label>
            </div>
          )}

          <label>
            <span>Initial message <small>Optional</small></span>
            <textarea
              value={prompt}
              rows={5}
              placeholder="What should the agent work on?"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
        </div>

        {error && <p className="action-dialog-error">{error}</p>}
        <footer>
          <button className="secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={pending}>{pending ? "Starting…" : "Create"}</button>
        </footer>
      </form>
    </dialog>
  );
}

function AgentPicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = AGENT_KINDS.filter(({ kind, label }) =>
    !query || kind.includes(query) || label.toLowerCase().includes(query)
  );

  return (
    <div
      ref={root}
      className="agent-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        value={value}
        maxLength={32}
        required
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        onClick={(event) => {
          event.currentTarget.select();
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown") {
            setQuery("");
            setOpen(true);
          }
        }}
        onChange={(event) => {
          const next = event.target.value.toLowerCase();
          onChange(next);
          setQuery(next);
          setOpen(true);
        }}
      />
      <button
        className="agent-picker-toggle"
        type="button"
        aria-label="Show agent choices"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="agent-picker-options" id={listId} role="listbox">
          {options.length > 0 ? options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.kind === value}
              key={option.kind}
              onClick={() => {
                onChange(option.kind);
                setQuery("");
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              <small>{option.kind}</small>
            </button>
          )) : <p>No matching configured agent</p>}
        </div>
      )}
    </div>
  );
}

function creationLocation(
  choice: string,
  worktree: { branch: string; base: string; path: string; label: string },
): ThreadCreationLocation {
  if (choice.startsWith("worktree:")) {
    return { kind: "worktree", worktree_id: choice.slice("worktree:".length) };
  }
  if (choice === "create_worktree") {
    return {
      kind: "create_worktree",
      branch: worktree.branch.trim() || undefined,
      base: worktree.base.trim() || undefined,
      path: worktree.path.trim() || undefined,
      label: worktree.label.trim() || undefined,
    };
  }
  if (choice === "open_worktree") {
    return {
      kind: "open_worktree",
      path: worktree.path.trim(),
      label: worktree.label.trim() || undefined,
    };
  }
  return { kind: "project" };
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
