import { useId, useRef, useState, type FormEvent } from "react";
import type { ProjectInfo, ThreadCreationLocation, ThreadCreationRequest, WorktreeInfo } from "../shared/protocol";
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
  const [agent, setAgent] = useState<string>(
    () => availableAgents.find((option) => option.kind === defaultAgent)?.kind ?? availableAgents[0]?.kind ?? "",
  );
  const [skipPermissions, setSkipPermissions] = useState(defaultSkipPermissions);
  const [locationChoice, setLocationChoice] = useState("project");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [path, setPath] = useState("");
  const [worktreeLabel, setWorktreeLabel] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const checkoutRef = useRef<HTMLInputElement>(null);
  const optionsId = useId();
  const selectedAgent = availableAgents.find((option) => option.kind === agent);
  const missingPath = locationChoice === "open_worktree" && !path.trim();
  const canSubmit = !pending && Boolean(selectedAgent) && !missingPath;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const location = creationLocation(locationChoice, { branch, base, path, label: worktreeLabel });
    onCreate({
      agent: agent.trim(),
      skip_permissions: (skipPermissions && AGENT_KINDS.some((option) => option.kind === agent.trim())) || undefined,
      location,
    });
  }

  const creatingWorktree = locationChoice === "create_worktree";
  const openingWorktree = locationChoice === "open_worktree";
  const projectCheckout = worktrees.find((worktree) => worktree.checkout_path === project.repo_root);
  const otherWorktrees = worktrees.filter((worktree) => worktree.checkout_path !== project.repo_root);
  const branchesId = useId();

  return (
    <TaskSurface
      title="New thread"
      description={`${project.name} · ${hostLabel}`}
      className="creation-dialog preferences-screen"
      fitViewport
      busy={pending}
      activity={pending ? <WorkingActivity themeId={themeId} /> : undefined}
      initialFocusRef={checkoutRef}
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          {(error || missingPath || !selectedAgent) && (
            <p className="surface-error creation-feedback" role="status">
              {error ||
                (missingPath
                  ? "Enter a checkout path to continue."
                  : "No available agent. Reopen this form when the host is connected.")}
            </p>
          )}
          <button className="surface-button secondary" type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
          <button className="surface-button primary" type="submit" disabled={!canSubmit}>
            {pending ? "Starting…" : "Start Thread"}
          </button>
        </>
      }
    >
      <fieldset className="creation-form-fields" disabled={pending}>
        <fieldset className="checkout-picker">
          <legend>Where should this thread work?</legend>
          <label className={`checkout-choice ${locationChoice === "project" ? "selected" : ""}`}>
            <input
              ref={checkoutRef}
              type="radio"
              name="checkout"
              value="project"
              checked={locationChoice === "project"}
              onChange={(event) => setLocationChoice(event.target.value)}
            />
            <span>
              <strong>{projectCheckout?.branch ?? "Project checkout"}</strong>
              <small>{projectCheckout?.branch ? "Project checkout" : "Use the project’s existing files"}</small>
              <span className="checkout-path">{project.repo_root}</span>
            </span>
          </label>
          {otherWorktrees.map((worktree) => (
            <label
              className={`checkout-choice ${locationChoice === `worktree:${worktree.worktree_id}` ? "selected" : ""}`}
              key={worktree.worktree_id}
            >
              <input
                type="radio"
                name="checkout"
                value={`worktree:${worktree.worktree_id}`}
                checked={locationChoice === `worktree:${worktree.worktree_id}`}
                onChange={(event) => setLocationChoice(event.target.value)}
              />
              <span>
                <strong title={worktree.branch ?? worktree.label}>{worktree.branch ?? worktree.label}</strong>
                <small>Existing worktree</small>
                <span className="checkout-path" title={worktree.checkout_path}>
                  {worktree.checkout_path}
                </span>
              </span>
            </label>
          ))}
          <label className={`checkout-choice ${creatingWorktree ? "selected" : ""}`}>
            <input
              type="radio"
              name="checkout"
              value="create_worktree"
              checked={creatingWorktree}
              onChange={(event) => setLocationChoice(event.target.value)}
            />
            <span>
              <strong>New worktree</strong>
              <small>A separate checkout for this thread</small>
            </span>
          </label>
          {creatingWorktree && (
            <div className="creation-fields checkout-details">
              <label>
                <span>
                  Branch <small>Optional</small>
                </span>
                <input
                  value={branch}
                  list={branchesId}
                  placeholder="New or existing branch name"
                  onChange={(event) => setBranch(event.target.value)}
                />
              </label>
              <datalist id={branchesId}>
                {[...new Set(worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])))].map(
                  (name) => (
                    <option value={name} key={name} />
                  ),
                )}
              </datalist>
              <p className="checkout-help">
                Leave blank to generate a branch. To use a branch already checked out, select its worktree above.
              </p>
              <label>
                <span>
                  Start from <small>Optional</small>
                </span>
                <input
                  value={base}
                  list={branchesId}
                  placeholder="Current HEAD"
                  onChange={(event) => setBase(event.target.value)}
                />
              </label>
              <details className="checkout-advanced">
                <summary>Custom path and label</summary>
                <div className="creation-subfields">
                  <label>
                    <span>
                      Checkout path <small>Optional</small>
                    </span>
                    <input
                      value={path}
                      placeholder="Managed by Herdr"
                      onChange={(event) => setPath(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>
                      Label <small>Optional</small>
                    </span>
                    <input value={worktreeLabel} onChange={(event) => setWorktreeLabel(event.target.value)} />
                  </label>
                </div>
              </details>
            </div>
          )}
          <label className={`checkout-choice ${openingWorktree ? "selected" : ""}`}>
            <input
              type="radio"
              name="checkout"
              value="open_worktree"
              checked={openingWorktree}
              onChange={(event) => setLocationChoice(event.target.value)}
            />
            <span>
              <strong>Open another checkout</strong>
              <small>Use an existing worktree by path</small>
            </span>
          </label>
          {openingWorktree && (
            <div className="creation-fields checkout-details">
              <label>
                <span>Checkout path</span>
                <input
                  value={path}
                  required
                  placeholder="/path/to/worktree"
                  onChange={(event) => setPath(event.target.value)}
                />
              </label>
            </div>
          )}
        </fieldset>

        <button
          className="thread-options-summary secondary"
          type="button"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          <span>
            {selectedAgent?.label ?? agent}
            {skipPermissions ? " · permissions skipped" : ""}
          </span>
          <strong>{optionsOpen ? "Hide agent settings" : "Agent settings"}</strong>
        </button>

        {optionsOpen && (
          <div className="creation-fields quick-thread-options" id={optionsId}>
            <label>
              <span>Agent</span>
              <select value={agent} required onChange={(event) => setAgent(event.target.value)}>
                {availableAgents.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
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
