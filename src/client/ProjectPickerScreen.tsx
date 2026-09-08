import type { HostedProject } from "./hosted-projects";
import { RadialMenu } from "./RadialMenu";

export function ProjectPickerScreen({
  projects, initialOffset, onOffsetChange, onClose, onBack, onSelect,
}: {
  projects: readonly HostedProject[];
  initialOffset?: number;
  onOffsetChange?(offset: number): void;
  onClose(): void;
  onBack?(): void;
  onSelect(project: HostedProject): void;
}) {
  return (
    <RadialMenu
      title="Choose a project"
      description="New thread · Project → Agent → Launch"
      options={projects.map(project => ({
        id: project.key,
        label: project.project.name,
        detail: `${project.host.label} · ${project.project.repo_root}${project.feedStatus !== "live" ? " · Offline" : ""}`,
        disabled: project.feedStatus !== "live",
      }))}
      emptyMessage="No projects yet. Open a repository in Herdr to get started."
      initialOffset={initialOffset}
      onOffsetChange={onOffsetChange}
      onClose={onClose}
      onBack={onBack}
      onSelect={id => {
        const project = projects.find(project => project.key === id);
        if (project?.feedStatus === "live") onSelect(project);
      }}
    />
  );
}
