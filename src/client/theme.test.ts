import { describe, expect, it } from "vitest";
import {
  activityColorsFor,
  readThemePreference,
  terminalThemeFor,
  themeOptions,
} from "./theme";

describe("theme catalog", () => {
  it("provides app activity and ANSI terminal colors for every choice", () => {
    expect(themeOptions.map((theme) => theme.label)).toEqual([
      "Dracula",
      "Catppuccin Mocha",
      "Tokyo Night",
      "Gruvbox Dark",
      "Nord",
    ]);

    for (const { id } of themeOptions) {
      expect(activityColorsFor(id).info).toMatch(/^#[0-9a-f]{6}$/i);
      expect(terminalThemeFor(id)).toMatchObject({
        background: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        foreground: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        red: expect.stringMatching(/^#[0-9a-f]{6}$/i),
        brightWhite: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      });
    }
  });

  it("falls back safely when a stored theme is no longer available", () => {
    expect(readThemePreference({ getItem: () => "tokyoNight" })).toBe("tokyoNight");
    expect(readThemePreference({ getItem: () => "retired-theme" })).toBe("dracula");
  });
});
