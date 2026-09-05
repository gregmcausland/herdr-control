import { expect, it, vi } from "vitest";
import controlReplies from "./pi";
import { capture } from "./capture.mjs";

vi.mock("./capture.mjs", () => ({ capture: vi.fn() }));

it("waits for an idle completed TUI reply and ignores tool turns and headless agents", () => {
  const handlers = new Map<string, (event: any, context: any) => void>();
  controlReplies({ on: (name: string, callback: any) => handlers.set(name, callback) });
  const context = {
    mode: "tui", isIdle: () => true,
    sessionManager: { getSessionId: () => "session-1", getSessionFile: () => "/tmp/session-1.jsonl" },
  };
  const emit = (name: string, event: any, ctx = context) => handlers.get(name)!(event, ctx);
  const message = { role: "assistant", content: [{ type: "text", text: "The fix is ready." }], timestamp: 123, stopReason: "stop" };
  emit("message_end", { message: { ...message, stopReason: "toolUse" } });
  emit("agent_settled", {});
  expect(capture).not.toHaveBeenCalled();
  emit("message_end", { message });
  emit("agent_settled", {}, { ...context, isIdle: () => false });
  expect(capture).not.toHaveBeenCalled();
  emit("agent_settled", {});
  expect(capture).toHaveBeenCalledExactlyOnceWith("pi", expect.objectContaining({ last_assistant_message: "The fix is ready.", session_id: "session-1" }));
  emit("agent_settled", {});
  emit("message_end", { message }, { ...context, mode: "rpc" });
  emit("agent_settled", {});
  expect(capture).toHaveBeenCalledTimes(1);
});
