import { useEffect, useRef, type CSSProperties } from "react";
import type { AgentDefinition } from "../shared/agents";
import type { ProjectInfo } from "../shared/protocol";
import { PlusIcon } from "./ThreadCreationDialog";

interface LaunchStyle extends CSSProperties {
  "--launch-right": string;
  "--launch-bottom": string;
  "--launch-order": number;
}

export function ThreadLaunchMenu({
  project,
  agents,
  message,
  defaultAgent,
  onCancel,
  onSelect,
}: {
  project: ProjectInfo;
  agents: readonly AgentDefinition[];
  message?: string;
  defaultAgent: string;
  onCancel(): void;
  onSelect(agent: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const defaultButton = useRef<HTMLButtonElement>(null);
  const preferredAgent = agents.some((agent) => agent.kind === defaultAgent)
    ? defaultAgent
    : agents[0]?.kind;

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  useEffect(() => defaultButton.current?.focus(), [preferredAgent]);

  return (
    <dialog
      ref={dialog}
      className="thread-launcher-dialog"
      aria-label={`Choose an agent for ${project.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="thread-launcher"
      >
        <p className="thread-launcher-heading">New Thread in <strong>{project.name}</strong></p>
        {agents.length === 0 && <p className="thread-launcher-empty">{message ?? "No supported agents found"}</p>}
        <div className="thread-launcher-fan">
          {agents.map((agent, index) => {
            const degrees = agents.length === 1 ? 44 : 2 + index * (86 / (agents.length - 1));
            const angle = degrees * (Math.PI / 180);
            const radius = 165;
            return (
              <button
                ref={agent.kind === preferredAgent ? defaultButton : undefined}
                className={`thread-launch-agent ${agent.kind === preferredAgent ? "default" : ""}`}
                type="button"
                key={agent.kind}
                aria-label={agent.label}
                style={{
                  "--launch-right": `${8 + radius * Math.cos(angle)}px`,
                  "--launch-bottom": `${8 + radius * Math.sin(angle)}px`,
                  "--launch-order": index,
                } as LaunchStyle}
                onClick={() => onSelect(agent.kind)}
              >
                <span>{agent.label.slice(0, 2)}</span>
                <small>{agent.label}</small>
              </button>
            );
          })}
          <button className="thread-launch-close" type="button" aria-label="Close agent menu" onClick={onCancel}>
            <PlusIcon />
          </button>
        </div>
      </section>
    </dialog>
  );
}
