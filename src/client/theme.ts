import type { ITheme } from "@xterm/xterm";

/** The single source of visual tokens for both the app shell and terminal. */
export const theme = {
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
  font: {
    sans: "Inter, ui-sans-serif, system-ui, sans-serif",
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    terminalSize: 14,
  },
} as const;

export const terminalTheme: ITheme = {
  background: theme.color.terminal,
  foreground: theme.color.text,
  cursor: theme.color.text,
  cursorAccent: theme.color.terminal,
  selectionBackground: theme.color.border,
  ...theme.ansi,
};

export function applyAppTheme(root: HTMLElement = document.documentElement): void {
  const variables = {
    "--color-canvas": theme.color.canvas,
    "--color-terminal": theme.color.terminal,
    "--color-surface": theme.color.surface,
    "--color-surface-raised": theme.color.surfaceRaised,
    "--color-surface-interactive": theme.color.surfaceInteractive,
    "--color-surface-notice": theme.color.surfaceNotice,
    "--color-surface-danger": theme.color.surfaceDanger,
    "--color-surface-overlay": theme.color.surfaceOverlay,
    "--color-header": theme.color.header,
    "--color-text": theme.color.text,
    "--color-text-soft": theme.color.textSoft,
    "--color-text-muted": theme.color.textMuted,
    "--color-border": theme.color.border,
    "--color-border-strong": theme.color.borderStrong,
    "--color-border-hover": theme.color.borderHover,
    "--color-accent": theme.color.accent,
    "--color-info": theme.color.info,
    "--color-success": theme.color.success,
    "--color-danger": theme.color.danger,
    "--color-danger-text": theme.color.dangerText,
    "--color-idle": theme.color.idle,
    "--font-sans": theme.font.sans,
    "--font-mono": theme.font.mono,
  };

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, String(value));
  }
}
