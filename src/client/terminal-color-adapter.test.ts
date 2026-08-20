import { describe, expect, it } from "vitest";
import { createTerminalColorAdapter } from "./terminal-color-adapter";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => encoder.encode(value);
const text = (value: Uint8Array) => decoder.decode(value);

describe("terminal colour adaptation", () => {
  it("leaves dark themes byte-for-byte untouched", () => {
    const adapter = createTerminalColorAdapter("dracula");
    const input = bytes("\x1b[48;2;49;49;49mCodex ✓\x1b[0m");

    expect(adapter.transform(input)).toBe(input);
  });

  it.each([
    ["Codex", "49;49;49"],
    ["Pi green", "40;50;40"],
    ["Pi blue", "52;53;65"],
  ])("lifts the observed %s dark surface into a light theme", (_label, color) => {
    const adapter = createTerminalColorAdapter("solarizedLight");
    const output = text(adapter.transform(bytes(`\x1b[38;2;147;153;178;48;2;${color}mcontent\x1b[0m`)));
    const mapped = output.match(/48;2;(\d+);(\d+);(\d+)m/)?.slice(1).map(Number);

    expect(output).toContain("38;2;147;153;178");
    expect(output).not.toContain(`48;2;${color}m`);
    expect(mapped).toHaveLength(3);
    expect(Math.min(...mapped!)).toBeGreaterThan(190);
  });

  it("preserves bright semantic backgrounds", () => {
    const adapter = createTerminalColorAdapter("catppuccinLatte");
    const input = "\x1b[48;2;220;30;30merror\x1b[48;2;0;90;220mselected\x1b[0m";

    expect(text(adapter.transform(bytes(input)))).toBe(input);
  });

  it("supports colon-form true colour and dark 256-colour backgrounds", () => {
    const adapter = createTerminalColorAdapter("gruvboxLight");
    const output = text(adapter.transform(bytes("\x1b[48:2::49:49:49mone\x1b[48;5;236mtwo\x1b[48;5;196mthree")));

    expect(output).toMatch(/\x1b\[48:2::\d+:\d+:\d+mone/);
    expect(output).toMatch(/\x1b\[48;2;\d+;\d+;\d+mtwo/);
    expect(output).toContain("\x1b[48;5;196mthree");
  });

  it("holds fragmented SGR instructions until they can be transformed safely", () => {
    const adapter = createTerminalColorAdapter("solarizedLight");
    const first = adapter.transform(bytes("before\x1b[48;2;49"));
    const second = adapter.transform(bytes(";49;49mafter"));
    const output = text(concatenate(first, second));

    expect(text(first)).toBe("before");
    expect(output).toMatch(/^before\x1b\[48;2;\d+;\d+;\d+mafter$/);
    expect(output).not.toContain("48;2;49;49;49");
  });

  it("clears an incomplete instruction when a full terminal frame resets state", () => {
    const adapter = createTerminalColorAdapter("solarizedLight");
    expect(text(adapter.transform(bytes("before\x1b[48;2")))).toBe("before");

    adapter.reset();

    expect(text(adapter.transform(bytes(";49;49;49mafter")))).toBe(";49;49;49mafter");
  });

  it("preserves unrelated control sequences, OSC instructions, and UTF-8 bytes", () => {
    const adapter = createTerminalColorAdapter("solarizedLight");
    const first = adapter.transform(bytes("π\x1b"));
    const second = adapter.transform(bytes("]0;title\x07\x1b[2J✓"));

    expect(text(concatenate(first, second))).toBe("π\x1b]0;title\x07\x1b[2J✓");
  });
});

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
