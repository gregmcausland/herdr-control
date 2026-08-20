import { describe, expect, it } from "vitest";
import { applyFontSettings, DEFAULT_SETTINGS, readAppSettings, storeAppSettings } from "./settings";

describe("App settings", () => {
  it("stores and restores appearance and new-thread defaults", () => {
    let stored: string | null = null;
    const storage = {
      getItem: (key: string) => key === "herdr-control-settings" ? stored : null,
      setItem: (_key: string, value: string) => { stored = value; },
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: "catppuccinLatte" as const,
      defaultAgent: "claude",
      defaultSkipPermissions: true,
      interfaceFontSize: 17,
      terminalFontSize: 16,
      terminalCursorBlink: false,
    };

    storeAppSettings(settings, storage);

    expect(readAppSettings(storage)).toEqual(settings);
  });

  it("migrates the previous theme and thread creation preferences", () => {
    const legacyCreation = JSON.stringify({ agent: "pi", skipPermissions: { pi: true } });
    const storage = {
      getItem: (key: string) => ({
        "herdr-control-theme": "solarizedLight",
        "herdr-control-thread-creation": legacyCreation,
      })[key] ?? null,
    };

    expect(readAppSettings(storage)).toMatchObject({
      theme: "solarizedLight",
      defaultAgent: "pi",
      defaultSkipPermissions: true,
    });
  });

  it("bounds invalid stored values and applies font variables", () => {
    const storage = {
      getItem: (key: string) => key === "herdr-control-settings"
        ? JSON.stringify({
            theme: "retired",
            defaultAgent: "NOT VALID",
            interfaceFontFamily: "",
            interfaceFontSize: 99,
            terminalFontFamily: "Test Mono, monospace",
            terminalFontSize: 18,
          })
        : null,
    };
    const settings = readAppSettings(storage);
    const values = new Map<string, string>();
    const root = {
      style: { setProperty: (name: string, value: string) => { values.set(name, value); } },
    } as unknown as HTMLElement;

    applyFontSettings(settings, root);

    expect(settings).toMatchObject({
      theme: "dracula",
      defaultAgent: "codex",
      interfaceFontSize: 16,
      terminalFontFamily: "Test Mono, monospace",
      terminalFontSize: 18,
    });
    expect(values).toEqual(new Map([
      ["--font-sans", DEFAULT_SETTINGS.interfaceFontFamily],
      ["--font-mono", "Test Mono, monospace"],
      ["--font-size-interface", "16px"],
    ]));
  });
});
