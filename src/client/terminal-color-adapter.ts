import { terminalColorProfileFor, type ThemeId } from "./theme";

type Rgb = readonly [number, number, number];

const ESCAPE = 0x1b;
const OPEN_BRACKET = 0x5b;
const SGR_FINAL = 0x6d;
const DARK_BACKGROUND_LUMINANCE = 0.18;
const EMPTY = new Uint8Array();
const encoder = new TextEncoder();

export interface TerminalColorAdapter {
  transform(data: Uint8Array): Uint8Array;
  reset(): void;
}

/** Adapts terminal-owned true colours into a browser-local light palette. */
export function createTerminalColorAdapter(themeId: ThemeId): TerminalColorAdapter {
  const profile = terminalColorProfileFor(themeId);
  if (profile.appearance === "dark") {
    return { transform: (data) => data, reset: () => undefined };
  }
  return new LightTerminalColorAdapter(hexColor(profile.surface), hexColor(profile.surfaceRaised));
}

class LightTerminalColorAdapter implements TerminalColorAdapter {
  private carry = EMPTY;

  constructor(
    private readonly surface: Rgb,
    private readonly surfaceRaised: Rgb,
  ) {}

  transform(data: Uint8Array): Uint8Array {
    const input = this.carry.length > 0 ? concatenate(this.carry, data) : data;
    this.carry = EMPTY;
    const output: Uint8Array[] = [];
    let copiedUntil = 0;
    let cursor = 0;

    while (cursor < input.length) {
      if (input[cursor] !== ESCAPE) {
        cursor += 1;
        continue;
      }
      if (cursor + 1 >= input.length) {
        output.push(input.subarray(copiedUntil, cursor));
        this.carry = input.slice(cursor);
        return concatenate(...output);
      }
      if (input[cursor + 1] !== OPEN_BRACKET) {
        cursor += 2;
        continue;
      }

      let final = cursor + 2;
      while (final < input.length && !isCsiFinal(input[final])) final += 1;
      if (final >= input.length) {
        output.push(input.subarray(copiedUntil, cursor));
        this.carry = input.slice(cursor);
        return concatenate(...output);
      }
      if (input[final] !== SGR_FINAL) {
        cursor = final + 1;
        continue;
      }

      const params = ascii(input.subarray(cursor + 2, final));
      const adapted = adaptSgrBackgrounds(params, (color) => this.adaptBackground(color));
      if (adapted !== params) {
        output.push(
          input.subarray(copiedUntil, cursor + 2),
          encoder.encode(adapted),
          input.subarray(final, final + 1),
        );
        copiedUntil = final + 1;
      }
      cursor = final + 1;
    }

    if (output.length === 0) return input;
    output.push(input.subarray(copiedUntil));
    return concatenate(...output);
  }

  reset(): void {
    this.carry = EMPTY;
  }

  private adaptBackground(color: Rgb): Rgb {
    const luminance = relativeLuminance(color);
    const source = rgbToHsl(color);
    if (
      luminance >= DARK_BACKGROUND_LUMINANCE
      || (source.saturation >= 0.35 && source.lightness >= 0.18)
    ) return color;

    const base = mixColor(
      this.surfaceRaised,
      this.surface,
      Math.min(1, luminance / DARK_BACKGROUND_LUMINANCE),
    );
    if (source.saturation < 0.15) return base;

    const target = rgbToHsl(base);
    return hslToRgb({
      hue: source.hue,
      saturation: Math.min(0.32, Math.max(target.saturation, source.saturation * 0.28)),
      lightness: target.lightness,
    });
  }
}

function adaptSgrBackgrounds(params: string, adapt: (color: Rgb) => Rgb): string {
  const tokens = params.split(";");
  const output: string[] = [];

  for (let index = 0; index < tokens.length;) {
    const colon = adaptColonBackground(tokens[index], adapt);
    if (colon !== tokens[index]) {
      output.push(colon);
      index += 1;
      continue;
    }

    if (tokens[index] === "48" && tokens[index + 1] === "2") {
      const colorStart = tokens[index + 2] === "" ? index + 3 : index + 2;
      const color = rgbTokens(tokens, colorStart);
      if (color) {
        const mapped = adapt(color);
        output.push("48", "2");
        if (colorStart === index + 3) output.push("");
        output.push(...mapped.map(String));
        index = colorStart + 3;
        continue;
      }
    }

    if (tokens[index] === "48" && tokens[index + 1] === "5") {
      const paletteIndex = byte(tokens[index + 2]);
      const color = paletteIndex === undefined ? undefined : indexedColor(paletteIndex);
      if (color) {
        const mapped = adapt(color);
        if (!sameColor(mapped, color)) output.push("48", "2", ...mapped.map(String));
        else output.push("48", "5", String(paletteIndex));
        index += 3;
        continue;
      }
    }

    output.push(tokens[index]);
    index += 1;
  }

  return output.join(";");
}

function adaptColonBackground(token: string, adapt: (color: Rgb) => Rgb): string {
  const parts = token.split(":");
  if (parts[0] !== "48") return token;

  if (parts[1] === "2" && parts.length >= 5) {
    const color = rgbTokens(parts, parts.length - 3);
    if (!color) return token;
    const mapped = adapt(color);
    parts.splice(parts.length - 3, 3, ...mapped.map(String));
    return parts.join(":");
  }

  if (parts[1] === "5") {
    const paletteIndex = byte(parts.at(-1));
    const color = paletteIndex === undefined ? undefined : indexedColor(paletteIndex);
    if (!color) return token;
    const mapped = adapt(color);
    return sameColor(mapped, color) ? token : `48:2:${mapped.join(":")}`;
  }
  return token;
}

function indexedColor(index: number): Rgb | undefined {
  if (index < 16) return undefined;
  if (index < 232) {
    const value = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return [levels[Math.floor(value / 36)], levels[Math.floor(value / 6) % 6], levels[value % 6]];
  }
  const grey = 8 + (index - 232) * 10;
  return [grey, grey, grey];
}

function rgbTokens(tokens: string[], start: number): Rgb | undefined {
  const red = byte(tokens[start]);
  const green = byte(tokens[start + 1]);
  const blue = byte(tokens[start + 2]);
  return red === undefined || green === undefined || blue === undefined ? undefined : [red, green, blue];
}

function byte(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,3}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= 255 ? parsed : undefined;
}

function isCsiFinal(value: number): boolean {
  return value >= 0x40 && value <= 0x7e;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function hexColor(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function mixColor(first: Rgb, second: Rgb, amount: number): Rgb {
  return first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount)) as unknown as Rgb;
}

function sameColor(first: Rgb, second: Rgb): boolean {
  return first.every((channel, index) => channel === second[index]);
}

function relativeLuminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function rgbToHsl([redByte, greenByte, blueByte]: Rgb): {
  hue: number;
  saturation: number;
  lightness: number;
} {
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const segment = maximum === red
    ? ((green - blue) / delta) % 6
    : maximum === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return { hue: (segment * 60 + 360) % 360, saturation, lightness };
}

function hslToRgb(color: { hue: number; saturation: number; lightness: number }): Rgb {
  const chroma = (1 - Math.abs(2 * color.lightness - 1)) * color.saturation;
  const segment = color.hue / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [red, green, blue] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const match = color.lightness - chroma / 2;
  return [red, green, blue].map((channel) => Math.round((channel + match) * 255)) as unknown as Rgb;
}
