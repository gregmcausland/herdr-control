import { useId, useRef, useState, type FormEvent } from "react";
import type {
  ProjectInfo,
  ThreadCreationLocation,
  ThreadCreationRequest,
  WorktreeInfo,
} from "../shared/protocol";
import { AGENT_KINDS, type AgentDefinition } from "../shared/agents";
import { TaskSurface } from "./Surface";
import type { ThemeId } from "./theme";
import { WorkingActivity } from "./WorkingActivity";

export function ThreadCreationDialog({
  project,
  hostLabel,
  worktrees,
  error,
  pending,
  defaultAgent,
  defaultSkipPermissions,
  availableAgents,
  themeId,
  onCancel,
  onCreate,
}: {
  project: ProjectInfo;
  hostLabel: string;
  worktrees: WorktreeInfo[];
  error?: string;
  pending: boolean;
  defaultAgent: string;
  defaultSkipPermissions: boolean;
  availableAgents: readonly AgentDefinition[];
  themeId: ThemeId;
  onCancel(): void;
  onCreate(request: ThreadCreationRequest): void;
}) {
  const [agent, setAgent] = useState<string>(() => availableAgents.find(option => option.kind === defaultAgent)?.kind ?? availableAgents[0]?.kind ?? "");
  const [skipPermissions, setSkipPermissions] = useState(defaultSkipPermissions);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [locationChoice, setLocationChoice] = useState("project");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [path, setPath] = useState("");
  const [worktreeLabel, setWorktreeLabel] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const optionsId = useId();
  const selectedAgent = availableAgents.find(option => option.kind === agent);
  const missingPath = locationChoice === "open_worktree" && !path.trim();
  const canSubmit = !pending && Boolean(selectedAgent) && !missingPath;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
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
  const locationLabel = locationChoice === "project"
    ? "Project default"
    : locationChoice === "create_worktree"
      ? "New Worktree"
      : locationChoice === "open_worktree"
        ? "Existing Worktree"
        : worktrees.find((worktree) => `worktree:${worktree.worktree_id}` === locationChoice)?.label ?? "Worktree";

  return (
    <TaskSurface
      title="New thread"
      context={project.name}
      description={hostLabel}
      className="creation-dialog"
      fitViewport
      busy={pending}
      activity={pending ? <WorkingActivity themeId={themeId} /> : undefined}
      initialFocusRef={promptRef}
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          {(error || missingPath || !selectedAgent) && <p className="surface-error creation-feedback" role="status">{error || (missingPath ? "Enter a checkout path in Options to continue." : "No available agent. Reopen this form when the host is connected.")}</p>}
          <button className="surface-button secondary" type="button" disabled={pending} onClick={onCancel}>Cancel</button>
          <button className="surface-button primary" type="submit" disabled={!canSubmit}>
            {pending ? "Starting…" : "Start Thread"}
          </button>
        </>
      }
    >
      <fieldset className="creation-form-fields" disabled={pending}>
        <label className="quick-thread-prompt">
          <span>What should {selectedAgent?.label ?? agent} work on?</span>
          <textarea
            ref={promptRef}
            value={prompt}
            rows={7}
            placeholder="Describe the task…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>

        <button
          className="thread-options-summary secondary"
          type="button"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          <span>{selectedAgent?.label ?? agent} · {locationLabel}{skipPermissions ? " · permissions skipped" : ""}</span>
          <strong>{optionsOpen ? "Hide options" : "Options"}</strong>
        </button>

        {optionsOpen && (
          <div className="creation-fields quick-thread-options" id={optionsId}>
            <label>
              <span>Agent</span>
              <select value={agent} required onChange={event => setAgent(event.target.value)}>
                {availableAgents.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}
              </select>
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

          </div>
        )}

      </fieldset>
    </TaskSurface>
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
