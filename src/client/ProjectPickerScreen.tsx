import type { HostedProject } from "./hosted-projects";
import { TaskSurface } from "./Surface";

export function ProjectPickerScreen({
  projects,
  onClose,
  onSelect,
}: {
  projects: readonly HostedProject[];
  onClose(): void;
  onSelect(project: HostedProject): void;
}) {
  return (
    <TaskSurface
      title="Choose a project"
      className="project-picker-screen"
      actions={(
        <button className="surface-button secondary" type="button" onClick={onClose}>Cancel</button>
      )}
      onClose={onClose}
    >
      <div className="project-picker-list">
        {projects.map((project) => (
          <button
            className="project-picker-item"
            type="button"
            key={project.key}
            disabled={project.feedStatus !== "live"}
            onClick={() => onSelect(project)}
          >
            <span>{project.project.name}</span>
            <small>{project.host.label} · {project.project.repo_root}</small>
          </button>
        ))}
      </div>
    </TaskSurface>
  );
}
