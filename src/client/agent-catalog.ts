export const AGENT_KINDS = [
  { kind: "codex", label: "Codex", permissionHelp: "Bypasses approvals and sandboxing for this run." },
  { kind: "claude", label: "Claude", permissionHelp: "Bypasses all permission checks for this run." },
  { kind: "gemini", label: "Gemini", permissionHelp: "Uses YOLO approval mode for this run." },
  { kind: "pi", label: "Pi", permissionHelp: "Trusts project-local agent files for this run." },
  { kind: "opencode", label: "OpenCode", permissionHelp: "Auto-approves requests unless explicitly denied." },
] as const;
