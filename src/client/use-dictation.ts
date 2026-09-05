import { useCallback, useEffect, useRef, useState } from "react";
import { readApiResponse } from "./conversation-api";

type Phase = "idle" | "starting" | "recording" | "transcribing";
type Recording = {
  controller: AbortController;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
};

function release(recording: Recording) {
  clearInterval(recording.timer);
  if (recording.recorder?.state === "recording") recording.recorder.stop();
  recording.stream?.getTracks().forEach(track => track.stop());
}

/** Owns microphone lifetime and drops late results after cancellation or navigation. */
export function useDictation(bridgeUrl: string, onTranscript: (text: string) => void) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const current = useRef<Recording | undefined>(undefined);
  const receive = useRef(onTranscript);
  receive.current = onTranscript;

  const cancel = useCallback(() => {
    const recording = current.current;
    current.current = undefined;
    if (recording) { recording.controller.abort(); release(recording); }
    setPhase("idle");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAvailable(false);
    if (window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined") {
      void fetch(`${bridgeUrl}/api/transcription`, { signal: controller.signal })
        .then(readApiResponse)
        .then(body => { if (!controller.signal.aborted) setAvailable(body.available === true); })
        .catch(() => undefined);
    }
    // Leaving the page must release the microphone, including a pending permission request.
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      controller.abort(); cancel();
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [bridgeUrl, cancel]);

  const stop = () => {
    const recording = current.current;
    if (!recording?.recorder || recording.recorder.state !== "recording") return;
    setPhase("transcribing");
    release(recording);
  };

  const start = async () => {
    if (!available || current.current) return;
    const recording: Recording = { controller: new AbortController() };
    current.current = recording;
    setError(undefined); setSeconds(0); setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recording.stream = stream;
      if (current.current !== recording) { release(recording); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot record a supported audio format. Try keyboard dictation.");
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recording.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (current.current !== recording) return;
        cancel(); setError("Recording was interrupted. Please try again.");
      };
      recorder.onstop = async () => {
        release(recording);
        if (current.current !== recording) return;
        setPhase("transcribing");
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType });
          if (!audio.size) throw new Error("The recording was empty. Please try again.");
          const response = await fetch(`${bridgeUrl}/api/transcription`, {
            method: "POST", headers: { "Content-Type": audio.type }, body: audio,
            signal: AbortSignal.any([recording.controller.signal, AbortSignal.timeout(60_000)]),
          });
          const body = await readApiResponse(response);
          if (typeof body.text !== "string" || !body.text.trim()) throw new Error("No speech was recognised. Please try again.");
          if (current.current === recording) receive.current(body.text.trim());
        } catch (error) {
          if (current.current === recording) setError(error instanceof Error ? error.message : "Transcription failed. Please try again.");
        } finally {
          if (current.current === recording) { current.current = undefined; setPhase("idle"); }
        }
      };
      recorder.start();
      setPhase("recording");
      const began = Date.now();
      recording.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - began) / 1_000);
        setSeconds(elapsed);
        if (elapsed >= 120) stop();
      }, 1_000);
    } catch (error) {
      if (current.current !== recording) return;
      cancel();
      setError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser to use voice input."
        : error instanceof Error ? error.message : "Unable to open the microphone.");
    }
  };

  return { available, phase, seconds, error, start, stop, cancel, busy: phase !== "idle" };
}
