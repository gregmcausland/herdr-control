import { describe, expect, it } from "vitest";
import {
  readThreadCreationPreferences,
  storeThreadCreationPreferences,
} from "./thread-creation-preferences";

describe("Thread creation preferences", () => {
  it("remembers the selected agent and permission choice independently per harness", () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    };

    storeThreadCreationPreferences({
      agent: "claude",
      skipPermissions: { codex: true, claude: false },
    }, storage);

    expect(readThreadCreationPreferences(storage)).toEqual({
      agent: "claude",
      skipPermissions: { codex: true, claude: false },
    });
  });

  it("falls back safely when stored preferences are invalid", () => {
    expect(readThreadCreationPreferences({ getItem: () => "not-json" })).toEqual({
      agent: "codex",
      skipPermissions: {},
    });
    expect(readThreadCreationPreferences({
      getItem: () => JSON.stringify({ agent: "INVALID AGENT", skipPermissions: { codex: "yes" } }),
    })).toEqual({ agent: "codex", skipPermissions: {} });
  });
});
