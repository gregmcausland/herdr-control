import { describe, expect, it, vi } from "vitest";
import { MAX_AUDIO_BYTES, TranscriptionService } from "./transcription";

describe("OpenAI transcription", () => {
  it("sends browser audio as a named file with terminology context and returns only text", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const form = options!.body as FormData;
      const file = form.get("file") as File;
      expect(file.name).toBe("recording.webm");
      expect(file.type).toBe("audio/webm");
      expect(await file.text()).toBe("recorded audio");
      expect(form.get("model")).toBe("gpt-transcribe");
      expect(form.get("prompt")).toContain("Schematify");
      expect(options!.headers).toEqual({ Authorization: "Bearer test-key" });
      return Response.json({ text: "  Review Herdr.  ", languages: [{ code: "en" }] });
    });
    const service = new TranscriptionService("test-key", undefined, request);
    await expect(service.transcribe(Buffer.from("recorded audio"), "audio/webm;codecs=opus")).resolves.toBe("Review Herdr.");
    expect(request.mock.calls[0][0]).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("rejects missing configuration, unsupported formats and oversized recordings before calling OpenAI", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new TranscriptionService(undefined, undefined, request).transcribe(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ statusCode: 503 });
    const service = new TranscriptionService("test-key", undefined, request);
    await expect(service.transcribe(Buffer.from("audio"), "text/html")).rejects.toMatchObject({ statusCode: 415 });
    await expect(service.transcribe(Buffer.alloc(0), "audio/webm")).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.transcribe(Buffer.alloc(MAX_AUDIO_BYTES + 1), "audio/webm")).rejects.toMatchObject({ statusCode: 413 });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not echo provider errors or retry a chargeable request", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ error: "private account details" }, { status: 429 }));
    const service = new TranscriptionService("test-key", undefined, request);
    await expect(service.transcribe(Buffer.from("audio"), "audio/mp4")).rejects.toMatchObject({
      statusCode: 429, message: "OpenAI's quota or rate limit was reached. Try again later.",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("allows another recording after a malformed response and rejects empty speech", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: "wrong shape" }))
      .mockResolvedValueOnce(Response.json({ text: " " }))
      .mockResolvedValueOnce(Response.json({ text: "Recovered" }));
    const service = new TranscriptionService("test-key", undefined, request);
    await expect(service.transcribe(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ statusCode: 502 });
    await expect(service.transcribe(Buffer.from("audio"), "audio/webm")).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.transcribe(Buffer.from("audio"), "audio/webm")).resolves.toBe("Recovered");
  });
});
