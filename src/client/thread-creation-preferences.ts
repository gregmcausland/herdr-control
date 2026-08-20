export interface ThreadCreationPreferences {
  agent: string;
  skipPermissions: Record<string, boolean>;
}

const STORAGE_KEY = "herdr-control-thread-creation";
const DEFAULT_PREFERENCES: ThreadCreationPreferences = {
  agent: "codex",
  skipPermissions: {},
};

export function readThreadCreationPreferences(
  storage: Pick<Storage, "getItem"> = localStorage,
): ThreadCreationPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!isRecord(parsed)) return { ...DEFAULT_PREFERENCES };
    const agent = validAgent(parsed.agent) ? parsed.agent : DEFAULT_PREFERENCES.agent;
    const skipPermissions = isRecord(parsed.skipPermissions)
      ? Object.fromEntries(Object.entries(parsed.skipPermissions).filter(
          ([kind, enabled]) => validAgent(kind) && typeof enabled === "boolean",
        )) as Record<string, boolean>
      : {};
    return { agent, skipPermissions };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function storeThreadCreationPreferences(
  preferences: ThreadCreationPreferences,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Launching must still work when browser storage is unavailable.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validAgent(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}
