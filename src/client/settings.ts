import { readThreadCreationPreferences } from "./thread-creation-preferences";
import { isThemeId, readThemePreference, themeFont, type ThemeId } from "./theme";

export interface AppSettings {
  theme: ThemeId;
  defaultAgent: string;
  defaultSkipPermissions: boolean;
  interfaceFontFamily: string;
  interfaceFontSize: number;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalCursorBlink: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dracula",
  defaultAgent: "codex",
  defaultSkipPermissions: false,
  interfaceFontFamily: themeFont.sans,
  interfaceFontSize: 16,
  terminalFontFamily: themeFont.mono,
  terminalFontSize: themeFont.terminalSize,
  terminalCursorBlink: true,
};

const STORAGE_KEY = "herdr-control-settings";

export function readAppSettings(storage: Pick<Storage, "getItem"> = localStorage): AppSettings {
  const legacyCreation = readThreadCreationPreferences(storage);
  const fallback: AppSettings = {
    ...DEFAULT_SETTINGS,
    theme: readThemePreference(storage),
    defaultAgent: legacyCreation.agent,
    defaultSkipPermissions: legacyCreation.skipPermissions[legacyCreation.agent] ?? false,
  };

  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!isRecord(parsed)) return fallback;
    return {
      theme: typeof parsed.theme === "string" && isThemeId(parsed.theme) ? parsed.theme : fallback.theme,
      defaultAgent: validAgent(parsed.defaultAgent) ? parsed.defaultAgent : fallback.defaultAgent,
      defaultSkipPermissions: typeof parsed.defaultSkipPermissions === "boolean"
        ? parsed.defaultSkipPermissions
        : fallback.defaultSkipPermissions,
      interfaceFontFamily: validFontFamily(parsed.interfaceFontFamily)
        ? parsed.interfaceFontFamily.trim()
        : fallback.interfaceFontFamily,
      interfaceFontSize: boundedNumber(parsed.interfaceFontSize, 13, 20, fallback.interfaceFontSize),
      terminalFontFamily: validFontFamily(parsed.terminalFontFamily)
        ? parsed.terminalFontFamily.trim()
        : fallback.terminalFontFamily,
      terminalFontSize: boundedNumber(parsed.terminalFontSize, 10, 32, fallback.terminalFontSize),
      terminalCursorBlink: typeof parsed.terminalCursorBlink === "boolean"
        ? parsed.terminalCursorBlink
        : fallback.terminalCursorBlink,
    };
  } catch {
    return fallback;
  }
}

export function storeAppSettings(
  settings: AppSettings,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings remain active for this session when browser storage is unavailable.
  }
}

export function applyFontSettings(
  settings: Pick<AppSettings, "interfaceFontFamily" | "interfaceFontSize" | "terminalFontFamily">,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--font-sans", settings.interfaceFontFamily);
  root.style.setProperty("--font-mono", settings.terminalFontFamily);
  root.style.setProperty("--font-size-interface", `${settings.interfaceFontSize}px`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validAgent(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

function validFontFamily(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}
