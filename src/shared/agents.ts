export const AGENT_KINDS = [
  {
    kind: "codex",
    executable: "codex",
    label: "Codex",
    permissionHelp: "Bypasses approvals and sandboxing for this run.",
  },
  {
    kind: "claude",
    executable: "claude",
    label: "Claude",
    permissionHelp: "Bypasses all permission checks for this run.",
  },
  {
    kind: "gemini",
    executable: "gemini",
    label: "Gemini",
    permissionHelp: "Uses YOLO approval mode for this run.",
  },
  {
    kind: "pi",
    executable: "pi",
    label: "Pi",
    permissionHelp: "Trusts project-local agent files for this run.",
  },
  {
    kind: "opencode",
    executable: "opencode",
    label: "OpenCode",
    permissionHelp: "Auto-approves requests unless explicitly denied.",
  },
] as const;

export type KnownAgentKind = typeof AGENT_KINDS[number]["kind"];
export type AgentDefinition = typeof AGENT_KINDS[number];

export interface AgentInventory {
  agents: KnownAgentKind[];
}

export function isKnownAgentKind(value: string): value is KnownAgentKind {
  return AGENT_KINDS.some((agent) => agent.kind === value);
}
