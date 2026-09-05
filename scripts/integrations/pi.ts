// Loaded inside the existing Pi process. No dependency on a particular Pi package name.
import { capture } from "./capture.mjs";

export default function controlReplies(pi: any) {
  let candidate: any;
  let candidateSession: string | undefined;
  let candidatePath: string | undefined;
  const emit = (ctx: any, role: "user" | "assistant", message: any) => {
    const text = typeof message.content === "string" ? message.content
      : (message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n\n");
    try { capture("pi", {
      hook_event_name: role === "user" ? "UserPromptSubmit" : "reply",
      session_id: ctx.sessionManager.getSessionId(), session_path: ctx.sessionManager.getSessionFile(),
      message_id: String(message.timestamp ?? Date.now()), prompt: text, last_assistant_message: text,
    }); } catch { /* Capture must not affect agent execution. */ }
  };
  pi.on("session_start", () => { candidate = undefined; });
  pi.on("message_end", (event: any, ctx: any) => {
    if (ctx.mode !== "tui") return;
    if (event.message.role === "user") emit(ctx, "user", event.message);
    if (event.message.role === "assistant") {
      candidate = event.message;
      candidateSession = ctx.sessionManager.getSessionId();
      candidatePath = ctx.sessionManager.getSessionFile();
    }
  });
  const settled = (_event: any, ctx: any) => {
    if (ctx.mode !== "tui" || !candidate || !ctx.isIdle() || candidateSession !== ctx.sessionManager.getSessionId()
      || candidatePath !== ctx.sessionManager.getSessionFile()) return;
    if (candidate.stopReason === "stop") emit(ctx, "assistant", candidate);
    candidate = undefined;
  };
  pi.on("agent_settled", settled);
}
