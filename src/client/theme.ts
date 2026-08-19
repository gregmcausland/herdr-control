import type { ITheme } from "@xterm/xterm";

interface ThemeColors {
  canvas: string;
  terminal: string;
  surface: string;
  surfaceRaised: string;
  surfaceInteractive: string;
  surfaceNotice: string;
  surfaceDanger: string;
  surfaceOverlay: string;
  header: string;
  text: string;
  textSoft: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  borderHover: string;
  accent: string;
  info: string;
  success: string;
  danger: string;
  dangerText: string;
  idle: string;
  activityVeil: string;
}

interface ThemeDefinition {
  label: string;
  color: ThemeColors;
  ansi: ITheme;
}

const themes = {
  dracula: {
    label: "Dracula",
    color: {
      canvas: "#282a36",
      terminal: "#282a36",
      surface: "#21222c",
      surfaceRaised: "#343746",
      surfaceInteractive: "#343746",
      surfaceNotice: "#343746",
      surfaceDanger: "#44475a",
      surfaceOverlay: "rgb(25 26 33 / 88%)",
      header: "#21222c",
      text: "#f8f8f2",
      textSoft: "#f8f8f2",
      textMuted: "#6272a4",
      border: "#44475a",
      borderStrong: "#6272a4",
      borderHover: "#bd93f9",
      accent: "#bd93f9",
      info: "#8be9fd",
      success: "#50fa7b",
      danger: "#ff5555",
      dangerText: "#ff6e6e",
      idle: "#6272a4",
      activityVeil: "#151827",
    },
    ansi: {
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  catppuccin: {
    label: "Catppuccin Mocha",
    color: {
      canvas: "#1e1e2e",
      terminal: "#1e1e2e",
      surface: "#181825",
      surfaceRaised: "#313244",
      surfaceInteractive: "#313244",
      surfaceNotice: "#313244",
      surfaceDanger: "#45475a",
      surfaceOverlay: "rgb(17 17 27 / 88%)",
      header: "#181825",
      text: "#cdd6f4",
      textSoft: "#cdd6f4",
      textMuted: "#7f849c",
      border: "#313244",
      borderStrong: "#585b70",
      borderHover: "#cba6f7",
      accent: "#cba6f7",
      info: "#89dceb",
      success: "#a6e3a1",
      danger: "#f38ba8",
      dangerText: "#f38ba8",
      idle: "#6c7086",
      activityVeil: "#11111b",
    },
    ansi: {
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  },
  tokyoNight: {
    label: "Tokyo Night",
    color: {
      canvas: "#1a1b26",
      terminal: "#1a1b26",
      surface: "#16161e",
      surfaceRaised: "#24283b",
      surfaceInteractive: "#24283b",
      surfaceNotice: "#24283b",
      surfaceDanger: "#3b2d3e",
      surfaceOverlay: "rgb(22 22 30 / 88%)",
      header: "#16161e",
      text: "#c0caf5",
      textSoft: "#a9b1d6",
      textMuted: "#565f89",
      border: "#292e42",
      borderStrong: "#414868",
      borderHover: "#bb9af7",
      accent: "#bb9af7",
      info: "#7dcfff",
      success: "#9ece6a",
      danger: "#f7768e",
      dangerText: "#ff9eae",
      idle: "#565f89",
      activityVeil: "#10121d",
    },
    ansi: {
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  gruvbox: {
    label: "Gruvbox Dark",
    color: {
      canvas: "#282828",
      terminal: "#282828",
      surface: "#1d2021",
      surfaceRaised: "#3c3836",
      surfaceInteractive: "#3c3836",
      surfaceNotice: "#3c3836",
      surfaceDanger: "#504945",
      surfaceOverlay: "rgb(29 32 33 / 88%)",
      header: "#1d2021",
      text: "#ebdbb2",
      textSoft: "#d5c4a1",
      textMuted: "#928374",
      border: "#3c3836",
      borderStrong: "#665c54",
      borderHover: "#d3869b",
      accent: "#d3869b",
      info: "#83a598",
      success: "#b8bb26",
      danger: "#fb4934",
      dangerText: "#fb4934",
      idle: "#928374",
      activityVeil: "#1d2021",
    },
    ansi: {
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  nord: {
    label: "Nord",
    color: {
      canvas: "#2e3440",
      terminal: "#2e3440",
      surface: "#272c36",
      surfaceRaised: "#3b4252",
      surfaceInteractive: "#3b4252",
      surfaceNotice: "#3b4252",
      surfaceDanger: "#4c3b46",
      surfaceOverlay: "rgb(36 41 51 / 88%)",
      header: "#272c36",
      text: "#eceff4",
      textSoft: "#e5e9f0",
      textMuted: "#8190aa",
      border: "#3b4252",
      borderStrong: "#4c566a",
      borderHover: "#b48ead",
      accent: "#b48ead",
      info: "#88c0d0",
      success: "#a3be8c",
      danger: "#bf616a",
      dangerText: "#d08770",
      idle: "#4c566a",
      activityVeil: "#242933",
    },
    ansi: {
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  catppuccinLatte: {
    label: "Catppuccin Latte",
    color: {
      canvas: "#eff1f5",
      terminal: "#eff1f5",
      surface: "#e6e9ef",
      surfaceRaised: "#ccd0da",
      surfaceInteractive: "#ccd0da",
      surfaceNotice: "#e6e9ef",
      surfaceDanger: "#f0d7dd",
      surfaceOverlay: "rgb(220 224 232 / 88%)",
      header: "#e6e9ef",
      text: "#4c4f69",
      textSoft: "#5c5f77",
      textMuted: "#7c7f93",
      border: "#ccd0da",
      borderStrong: "#acb0be",
      borderHover: "#8839ef",
      accent: "#8839ef",
      info: "#209fb5",
      success: "#40a02b",
      danger: "#d20f39",
      dangerText: "#d20f39",
      idle: "#9ca0b0",
      activityVeil: "#dce0e8",
    },
    ansi: {
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#ea76cb",
      brightCyan: "#179299",
      brightWhite: "#bcc0cc",
    },
  },
  solarizedLight: {
    label: "Solarized Light",
    color: {
      canvas: "#fdf6e3",
      terminal: "#fdf6e3",
      surface: "#eee8d5",
      surfaceRaised: "#e5deca",
      surfaceInteractive: "#e5deca",
      surfaceNotice: "#eee8d5",
      surfaceDanger: "#f3ddd4",
      surfaceOverlay: "rgb(238 232 213 / 90%)",
      header: "#eee8d5",
      text: "#657b83",
      textSoft: "#586e75",
      textMuted: "#839496",
      border: "#ded7c4",
      borderStrong: "#93a1a1",
      borderHover: "#6c71c4",
      accent: "#6c71c4",
      info: "#268bd2",
      success: "#859900",
      danger: "#dc322f",
      dangerText: "#dc322f",
      idle: "#93a1a1",
      activityVeil: "#eee8d5",
    },
    ansi: {
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  gruvboxLight: {
    label: "Gruvbox Light",
    color: {
      canvas: "#fbf1c7",
      terminal: "#fbf1c7",
      surface: "#ebdbb2",
      surfaceRaised: "#d5c4a1",
      surfaceInteractive: "#d5c4a1",
      surfaceNotice: "#ebdbb2",
      surfaceDanger: "#efd4c1",
      surfaceOverlay: "rgb(235 219 178 / 90%)",
      header: "#f2e5bc",
      text: "#3c3836",
      textSoft: "#504945",
      textMuted: "#7c6f64",
      border: "#d5c4a1",
      borderStrong: "#bdae93",
      borderHover: "#8f3f71",
      accent: "#8f3f71",
      info: "#076678",
      success: "#79740e",
      danger: "#9d0006",
      dangerText: "#9d0006",
      idle: "#a89984",
      activityVeil: "#ebdbb2",
    },
    ansi: {
      black: "#fbf1c7",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#7c6f64",
      brightBlack: "#928374",
      brightRed: "#9d0006",
      brightGreen: "#79740e",
      brightYellow: "#b57614",
      brightBlue: "#076678",
      brightMagenta: "#8f3f71",
      brightCyan: "#427b58",
      brightWhite: "#3c3836",
    },
  },
} as const satisfies Record<string, ThemeDefinition>;

export type ThemeId = keyof typeof themes;

export const themeOptions: ReadonlyArray<{ id: ThemeId; label: string }> = Object.entries(themes).map(
  ([id, definition]) => ({ id: id as ThemeId, label: definition.label }),
);

export const themeFont = {
  sans: "Inter, ui-sans-serif, system-ui, sans-serif",
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  terminalSize: 14,
} as const;

const STORAGE_KEY = "herdr-control-theme";

export function isThemeId(value: string | null): value is ThemeId {
  return value !== null && Object.hasOwn(themes, value);
}

export function readThemePreference(storage: Pick<Storage, "getItem"> = localStorage): ThemeId {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : "dracula";
  } catch {
    return "dracula";
  }
}

export function storeThemePreference(themeId: ThemeId, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, themeId);
  } catch {
    // A blocked storage backend should not prevent an in-memory theme change.
  }
}

export function themeLabel(themeId: ThemeId): string {
  return themes[themeId].label;
}

export function terminalThemeFor(themeId: ThemeId): ITheme {
  const theme = themes[themeId];
  return {
    background: theme.color.terminal,
    foreground: theme.color.text,
    cursor: theme.color.text,
    cursorAccent: theme.color.terminal,
    selectionBackground: theme.color.border,
    ...theme.ansi,
  };
}

export function activityColorsFor(themeId: ThemeId): { muted: string; info: string; accent: string } {
  const { textMuted, info, accent } = themes[themeId].color;
  return { muted: textMuted, info, accent };
}

/** Applies the selected palette to every CSS-driven app surface. */
export function applyAppTheme(themeId: ThemeId, root: HTMLElement = document.documentElement): void {
  const color = themes[themeId].color;
  const variables = {
    "--color-canvas": color.canvas,
    "--color-terminal": color.terminal,
    "--color-surface": color.surface,
    "--color-surface-raised": color.surfaceRaised,
    "--color-surface-interactive": color.surfaceInteractive,
    "--color-surface-notice": color.surfaceNotice,
    "--color-surface-danger": color.surfaceDanger,
    "--color-surface-overlay": color.surfaceOverlay,
    "--color-header": color.header,
    "--color-text": color.text,
    "--color-text-soft": color.textSoft,
    "--color-text-muted": color.textMuted,
    "--color-border": color.border,
    "--color-border-strong": color.borderStrong,
    "--color-border-hover": color.borderHover,
    "--color-accent": color.accent,
    "--color-info": color.info,
    "--color-success": color.success,
    "--color-danger": color.danger,
    "--color-danger-text": color.dangerText,
    "--color-idle": color.idle,
    "--color-activity-veil": color.activityVeil,
    "--font-sans": themeFont.sans,
    "--font-mono": themeFont.mono,
  };

  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", color.canvas);
}
