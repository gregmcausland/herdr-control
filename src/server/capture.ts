import { mkdir, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ThreadManager } from "./threads.js";
import { capturedThread, type CapturedMessage, type ConversationStore } from "./conversations.js";

/** Imports atomic host-side hook records, including those written while the bridge was down. */
export function collectReplies(directory: string, socketPath: string, threads: ThreadManager, conversations: ConversationStore) {
  let stopped = false;
  let running: Promise<void> | undefined;
  const scan = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    for (const name of files) {
      if (stopped) return;
      const path = join(directory, name);
      let event: CapturedMessage;
      try {
        const text = await readFile(path, "utf8");
        if (text.length > 2 * 1024 * 1024) throw new Error("Capture exceeded size limit");
        event = parseCapture(JSON.parse(text));
      } catch {
        await rename(path, `${path}.invalid`).catch(() => undefined);
        continue;
      }
      if (event.socket_path !== socketPath) continue;
      const thread = capturedThread(event, threads.list());
      if (!thread) continue; // Adoption/session reporting may arrive after the hook.
      conversations.captured(thread.thread_id, event);
      await unlink(path);
    }
  };
  const refresh = () => {
    if (stopped) return Promise.resolve();
    running ??= scan().catch((error) => console.error("Reply capture failed:", error.message)).finally(() => { running = undefined; });
    return running;
  };
  const timer = setInterval(() => void refresh(), 1000);
  timer.unref();
  void refresh();
  return { refresh, async close() { stopped = true; clearInterval(timer); await running; } };
}

function parseCapture(value: unknown): CapturedMessage {
  const event = value as CapturedMessage;
  if (!event || typeof event !== "object" || !["user", "assistant"].includes(event.role)
    || !["codex", "claude", "pi"].includes(event.agent)
    || ![event.event_id, event.pane_id, event.socket_path, event.text, event.created_at].every((value) => typeof value === "string" && value.length > 0)
    || !Number.isFinite(Date.parse(event.created_at))
    || (event.session_id !== undefined && typeof event.session_id !== "string")
    || (event.session_path !== undefined && typeof event.session_path !== "string")) throw new Error("Invalid reply capture");
  return event;
}
