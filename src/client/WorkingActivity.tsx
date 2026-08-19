import { useEffect, useRef } from "react";
import { activityColorsFor, type ThemeId } from "./theme";

type Rgb = readonly [number, number, number];

interface Point {
  x: number;
  y: number;
  phaseX: number;
  phaseY: number;
  pulse: number;
  sparkle: number;
}

interface Layer {
  points: Point[];
  cellX: number;
  cellY: number;
  reach: number;
  drift: number;
  line: Rgb;
  light: Rgb;
  opacity: number;
  lineWidth: number;
}

interface ActivityRenderer {
  render(time: number): void;
}

/** A self-contained, visibility-aware constellation renderer for working panes. */
export function WorkingActivity({ themeId }: { themeId: ThemeId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer(canvas, themeId);
    if (!renderer) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let frame: number | undefined;
    const startedAt = performance.now();

    const stop = () => {
      if (frame === undefined) return;
      cancelAnimationFrame(frame);
      frame = undefined;
    };
    const draw = (now: number) => {
      frame = undefined;
      renderer.render(motion.matches ? 4.5 : (now - startedAt) / 1_000);
      if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(draw);
    };
    const start = () => {
      if (frame === undefined && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const handleVisibility = () => document.hidden ? stop() : start();
    const handleMotion = () => {
      stop();
      start();
    };

    const resize = new ResizeObserver(start);
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    intersection.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    motion.addEventListener("change", handleMotion);
    start();

    return () => {
      stop();
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      motion.removeEventListener("change", handleMotion);
    };
  }, [themeId]);

  return <canvas ref={canvasRef} className="working-activity" aria-hidden="true" />;
}

function createRenderer(canvas: HTMLCanvasElement, themeId: ThemeId): ActivityRenderer | undefined {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  const colors = activityColorsFor(themeId);
  const palette = {
    muted: hexColor(colors.muted),
    info: hexColor(colors.info),
    accent: hexColor(colors.accent),
  };
  let width = 0;
  let height = 0;
  let layers: Layer[] = [];

  return {
    render(time) {
      const size = resizeCanvas(canvas, context);
      if (size.width !== width || size.height !== height) {
        width = size.width;
        height = size.height;
        layers = createLayers(width, height, palette);
      }

      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";
      for (const layer of layers) drawLayer(context, layer, width, height, time);
      context.restore();
    },
  };
}

function createLayers(width: number, height: number, palette: { muted: Rgb; info: Rgb; accent: Rgb }): Layer[] {
  return [
    createLayer(width, height, {
      cellX: 118,
      cellY: 34,
      reach: 150,
      drift: 0.32,
      line: mixColor(palette.muted, palette.accent, 0.14),
      light: mixColor(palette.muted, palette.accent, 0.28),
      opacity: 0.15,
      lineWidth: 0.7,
      seed: 13,
    }),
    createLayer(width, height, {
      cellX: 90,
      cellY: 27,
      reach: 120,
      drift: 0.48,
      line: mixColor(palette.muted, palette.info, 0.1),
      light: mixColor(palette.muted, palette.info, 0.24),
      opacity: 0.22,
      lineWidth: 0.8,
      seed: 47,
    }),
    createLayer(width, height, {
      cellX: 70,
      cellY: 22,
      reach: 94,
      drift: 0.66,
      line: mixColor(palette.muted, palette.info, 0.18),
      light: mixColor(palette.muted, palette.info, 0.42),
      opacity: 0.3,
      lineWidth: 0.9,
      seed: 91,
    }),
  ];
}

function createLayer(
  width: number,
  height: number,
  options: Omit<Layer, "points"> & { seed: number },
): Layer {
  const random = seededRandom(options.seed);
  const columns = Math.ceil(width / options.cellX) + 2;
  const rows = Math.ceil(height / options.cellY) + 4;
  const points: Point[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({
        x: (column - 1 + random() * 0.68) * options.cellX,
        y: (row - 2 + random() * 0.76) * options.cellY,
        phaseX: random() * Math.PI * 2,
        phaseY: random() * Math.PI * 2,
        pulse: random() * Math.PI * 2,
        sparkle: random(),
      });
    }
  }

  const { seed: _seed, ...layer } = options;
  return { ...layer, points };
}

function drawLayer(
  context: CanvasRenderingContext2D,
  layer: Layer,
  width: number,
  height: number,
  time: number,
): void {
  const positions = layer.points.map((point) => ({
    x: point.x
      + Math.sin(time * layer.drift + point.phaseX) * layer.cellX * 0.22
      + Math.cos(time * layer.drift * 0.37 + point.phaseY) * layer.cellX * 0.07,
    y: point.y
      + Math.cos(time * layer.drift * 0.86 + point.phaseY) * layer.cellY * 0.46
      + Math.sin(time * layer.drift * 0.42 + point.phaseX) * layer.cellY * 0.14,
  }));

  context.lineWidth = layer.lineWidth;
  for (let first = 0; first < positions.length; first += 1) {
    const a = positions[first];
    if (!nearCanvas(a, width, height, layer.reach)) continue;
    for (let second = first + 1; second < positions.length; second += 1) {
      const b = positions[second];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= layer.reach) continue;

      const proximity = 1 - distance / layer.reach;
      const pulse = 0.78 + 0.22 * Math.sin(time * 0.72 + layer.points[first].pulse + layer.points[second].pulse);
      const brightness = rightSideBrightness((a.x + b.x) / 2, width);
      const alpha = proximity * proximity * layer.opacity * pulse * brightness;
      context.strokeStyle = rgba(layer.line, alpha);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    if (!nearCanvas(position, width, height, 8)) continue;
    const point = layer.points[index];
    const pulse = 0.55 + 0.45 * Math.sin(time * (0.8 + point.sparkle * 0.7) + point.pulse);
    const flare = point.sparkle > 0.82 ? Math.pow(Math.max(0, pulse), 7) : 0;
    const radius = 0.65 + layer.opacity * 1.8 + flare * 1.5;
    const brightness = rightSideBrightness(position.x, width);

    context.fillStyle = rgba(layer.light, layer.opacity * (0.7 + pulse * 0.65) * brightness);
    context.shadowColor = rgba(layer.light, 0.7 * brightness);
    context.shadowBlur = 2 + flare * 9;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { width: number; height: number } {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function nearCanvas(point: { x: number; y: number }, width: number, height: number, margin: number): boolean {
  return point.x >= -margin && point.x <= width + margin && point.y >= -margin && point.y <= height + margin;
}

function rightSideBrightness(x: number, width: number): number {
  const progress = Math.max(0, Math.min(1, (x / width - 0.42) / 0.58));
  const eased = progress * progress * (3 - 2 * progress);
  return 1 + eased * 0.35;
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

function hexColor(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function mixColor(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}
