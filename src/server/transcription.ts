export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const AUDIO_FORMATS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};

export class TranscriptionError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

/** One bounded recording per request. Audio stays in memory and requests are never retried. */
export class TranscriptionService {
  private busy = false;

  constructor(
    private readonly apiKey?: string,
    private readonly model = "gpt-transcribe",
    private readonly request: typeof fetch = fetch,
  ) {}

  get available(): boolean { return Boolean(this.apiKey); }

  async transcribe(audio: Buffer, contentType: string | undefined, signal?: AbortSignal): Promise<string> {
    if (!this.available) throw new TranscriptionError("Voice input is not configured on this host.", 503);
    const mime = contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
    const extension = AUDIO_FORMATS[mime];
    if (!extension) throw new TranscriptionError("Use a WebM, MP4, WAV or MP3 recording.", 415);
    if (!audio.length) throw new TranscriptionError("The recording was empty. Please try again.", 400);
    if (audio.length > MAX_AUDIO_BYTES) throw new TranscriptionError("The recording is too large. Try a shorter message.", 413);
    if (this.busy) throw new TranscriptionError("Another recording is being transcribed. Try again shortly.", 429);

    this.busy = true;
    try {
      const body = new FormData();
      body.set("model", this.model);
      body.set("file", new Blob([new Uint8Array(audio)], { type: mime }), `recording.${extension}`);
      body.set("prompt", "Software development discussion. Names and terms: Herdr, Schematify, Codex, TypeScript, GitHub.");
      const response = await this.request("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body,
        signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]),
      });
      // Provider responses can include account details; return only our own errors.
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new TranscriptionError("OpenAI rejected the configured API key.", 502);
        if (response.status === 429) throw new TranscriptionError("OpenAI's quota or rate limit was reached. Try again later.", 429);
        throw new TranscriptionError("OpenAI could not transcribe this recording. Please try again.", 502);
      }
      const result = await response.json() as { text?: unknown };
      if (typeof result?.text !== "string") throw new TranscriptionError("OpenAI returned an invalid transcript.", 502);
      const text = result.text.trim();
      if (!text) throw new TranscriptionError("No speech was recognised. Please try again.", 422);
      return text;
    } catch (error) {
      if (error instanceof TranscriptionError) throw error;
      throw new TranscriptionError("Transcription was interrupted or timed out. Your draft is unchanged.", 502);
    } finally {
      this.busy = false;
    }
  }
}
