import type { AgentDefinition } from "../shared/agents";
import type { ProjectInfo } from "../shared/protocol";
import { RadialMenu } from "./RadialMenu";

export function ThreadLaunchMenu({
  project, agents, message, defaultAgent, onCancel, onBack, onSelect,
}: {
  project: ProjectInfo;
  agents: readonly AgentDefinition[];
  message?: string;
  defaultAgent: string;
  onCancel(): void;
  onBack(): void;
  onSelect(agent: string): void;
}) {
  return (
    <RadialMenu
      title={`Choose an agent for ${project.name}`}
      description="New thread · Project → Agent → Launch"
      options={agents.map(agent => ({ id: agent.kind, label: agent.label }))}
      emptyMessage={message ?? "No supported agents found on this host"}
      preferredId={defaultAgent}
      onClose={onCancel}
      onBack={onBack}
      onSelect={onSelect}
    />
  );
}
