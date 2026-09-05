import { useEffect, useRef, useState } from "react";

/** Draws recent microphone levels without playing audio or owning the recording stream. */
export function VoiceWaveform({ stream }: { stream: MediaStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const graphics = canvas.getContext("2d");
    if (!graphics || typeof AudioContext === "undefined") { setUnavailable(true); return; }
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let frame = 0;
    let stopped = false;
    const dispose = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      source?.disconnect();
      analyser?.disconnect();
      void context?.close().catch(() => undefined);
    };
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const levels = new Array<number>(56).fill(0);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let lastSample = 0;
      const draw = (now: number) => {
        if (stopped) return;
        frame = requestAnimationFrame(draw);
        if (now - lastSample < (reducedMotion.matches ? 125 : 50)) return;
        lastSample = now;
        analyser!.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
        levels.shift(); levels.push(level);

        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
          canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
        }
        graphics.setTransform(ratio, 0, 0, ratio, 0, 0);
        graphics.clearRect(0, 0, width, height);
        graphics.fillStyle = getComputedStyle(canvas).color;
        const spacing = width / levels.length;
        for (let index = 0; index < levels.length; index++) {
          const amplitude = reducedMotion.matches ? level : levels[index];
          const barHeight = 3 + amplitude * (height - 6);
          graphics.globalAlpha = reducedMotion.matches ? 1 : 0.25 + 0.75 * index / levels.length;
          graphics.beginPath();
          graphics.roundRect(index * spacing, (height - barHeight) / 2, Math.max(2, spacing - 3), barHeight, 2);
          graphics.fill();
        }
      };
      void context.resume().then(() => {
        if (!stopped) frame = requestAnimationFrame(draw);
      }).catch(() => { if (!stopped) { setUnavailable(true); dispose(); } });
    } catch {
      setUnavailable(true); dispose();
    }
    return dispose;
  }, [stream]);

  return unavailable ? <small className="voice-feedback-unavailable">Audio feedback unavailable</small>
    : <canvas ref={canvasRef} className="voice-waveform" role="img" aria-label="Live microphone waveform" />;
}
