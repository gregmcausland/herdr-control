import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConversationStore, capturedThread, type CapturedMessage } from "./conversations";
import { MessageDeliveryService } from "./message-delivery";
import { HerdrRequestError } from "./herdr-socket";
import type { ThreadLifecycleService } from "./thread-lifecycle";
import type { ThreadInfo } from "../shared/protocol";

const event: CapturedMessage = { event_id: "event-1", agent: "codex", session_id: "session-1", pane_id: "w1:p1", socket_path: "/tmp/herdr.sock", role: "assistant", text: "## Done\nThe fix is ready.", created_at: new Date().toISOString() };

describe("durable conversation delivery", () => {
  it("returns the same receipt for concurrent requests and after a lost acknowledgement", async () => {
    const store = new ConversationStore(":memory:");
    let finish!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const service = new MessageDeliveryService(store, { prompt } as unknown as ThreadLifecycleService, () => true);
    const first = service.send("thread-1", "message-1", "Continue");
    expect((await service.send("thread-1", "message-1", "Continue")).delivery).toBe("sending");
    finish();
    await first;
    expect((await service.send("thread-1", "message-1", "Continue")).delivery).toBe("acknowledged");
    expect(prompt).toHaveBeenCalledTimes(1);
    await expect(service.send("thread-2", "message-1", "Continue")).rejects.toThrow(/another submission/);
    store.close();
  });

  it("never retries an uncertain send, including an upstream stalled prompt", async () => {
    const store = new ConversationStore(":memory:");
    const prompt = vi.fn(async () => { throw new HerdrRequestError("agent_prompt_stalled", "No status change"); });
    const service = new MessageDeliveryService(store, { prompt } as unknown as ThreadLifecycleService, () => true);
    expect((await service.send("thread-1", "message-1", "Continue")).delivery).toBe("uncertain");
    await service.send("thread-1", "message-1", "Continue", true);
    expect(prompt).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("allows an explicit retry of a confirmed rejection", async () => {
    const store = new ConversationStore(":memory:");
    const prompt = vi.fn().mockRejectedValueOnce(new HerdrRequestError("agent_blocked", "Answer the terminal question")).mockResolvedValue(undefined);
    const service = new MessageDeliveryService(store, { prompt } as unknown as ThreadLifecycleService, () => true);
    expect((await service.send("thread-1", "message-1", "Continue")).delivery).toBe("failed");
    expect((await service.send("thread-1", "message-1", "Continue", true)).delivery).toBe("acknowledged");
    expect(store.list("thread-1").messages).toHaveLength(1);
    store.close();
  });

  it("retains replies and marks interrupted sends uncertain after a bridge restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "control-conversations-"));
    try {
      const path = join(directory, "control.db");
      const first = new ConversationStore(path);
      first.begin("thread-1", "message-1", "Continue");
      first.captured("thread-1", event);
      first.close();
      const reopened = new ConversationStore(path);
      expect(reopened.get("message-1")?.delivery).toBe("uncertain");
      reopened.captured("thread-1", event);
      expect(reopened.list("thread-1").messages).toHaveLength(2);
      expect(reopened.list("thread-1", 2).messages).toHaveLength(1);
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("merges a Control prompt echo but retains repeated desktop prompts", () => {
    const store = new ConversationStore(":memory:");
    store.begin("thread-1", "message-1", "Continue");
    store.captured("thread-1", { ...event, role: "user", text: "Continue" });
    store.captured("thread-1", { ...event, role: "user", text: "Continue", event_id: "event-2" });
    expect(store.list("thread-1").messages.map((message) => message.source)).toEqual(["control", "agent"]);
    store.close();
  });

  it("matches delayed replies by session and never assigns a replacement session's reply to the old thread", () => {
    const thread = { thread_id: "thread-1", agent: "codex", agent_session: { value: "session-1" }, current_run: { pane_id: "w1:p1", started_at: "2026-01-01" } } as ThreadInfo;
    expect(capturedThread({ ...event, pane_id: "w9:p7" }, [thread])).toBe(thread);
    expect(capturedThread({ ...event, session_id: "replacement" }, [thread])).toBeUndefined();
  });

  it.each([
    ["Continue ", "Continue", 1],
    ["\nContinue\r\nwith this\t\n", "Continue\nwith this", 1],
    ["Keep  two spaces", "Keep two spaces", 2],
  ])("matches provider whitespace changes without discarding internal whitespace: %j", (sent, captured, count) => {
    const store = new ConversationStore(":memory:");
    store.begin("thread-1", "message-1", sent);
    store.captured("thread-1", { ...event, role: "user", text: captured });
    store.captured("thread-1", { ...event, role: "user", text: captured });
    expect(store.list("thread-1").messages).toHaveLength(count);
    expect(store.get("message-1")?.text).toBe(sent);
    store.close();
  });
});
