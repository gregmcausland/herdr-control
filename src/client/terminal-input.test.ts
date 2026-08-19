import { describe, expect, it } from "vitest";
import { logicalTerminalKey } from "./terminal-input";

const key = (
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {},
) => ({
  key: value,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe("logical terminal keys", () => {
  it("preserves enhanced keys for Herdr to encode", () => {
    expect(logicalTerminalKey(key("Enter", { shiftKey: true }))).toBe("shift+enter");
    expect(logicalTerminalKey(key("ArrowDown"))).toBe("down");
    expect(logicalTerminalKey(key("Escape"))).toBe("esc");
  });

  it("preserves control chords", () => {
    expect(logicalTerminalKey(key("c", { ctrlKey: true }))).toBe("ctrl+c");
  });

  it("leaves ordinary text and browser shortcuts to xterm and the browser", () => {
    expect(logicalTerminalKey(key("a"))).toBeUndefined();
    expect(logicalTerminalKey(key("r", { metaKey: true }))).toBeUndefined();
  });
});
