#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** Writes locally before returning, so capture never depends on a live bridge. */
export function capture(agent, payload, environment = process.env, directory) {
  if (environment.HERDR_ENV !== "1" || !environment.HERDR_PANE_ID || !environment.HERDR_SOCKET_PATH || payload.agent_id) return;
  const sessionId = payload.session_id ?? payload["thread-id"];
  if (agent === "codex" && environment.CODEX_THREAD_ID && environment.CODEX_THREAD_ID !== sessionId) return;
  const kind = payload.hook_event_name;
  const role = kind === "UserPromptSubmit" ? "user" : "assistant";
  if (!["UserPromptSubmit", "Stop", "reply"].includes(kind) && payload.type !== "agent-turn-complete") return;
  const text = role === "user" ? payload.prompt : payload.last_assistant_message ?? payload["last-assistant-message"];
  if (typeof text !== "string" || !text.trim() || !sessionId) return;
  const timestamp = payload.captured_at ?? new Date().toISOString();
  const turn = payload.turn_id ?? payload["turn-id"] ?? payload.message_id ?? randomUUID();
  const eventId = createHash("sha256").update(JSON.stringify([agent, sessionId, turn, role, text])).digest("hex");
  const event = {
    event_id: eventId, agent, session_id: sessionId, session_path: payload.session_path,
    pane_id: environment.HERDR_PANE_ID, socket_path: environment.HERDR_SOCKET_PATH,
    role, text, created_at: timestamp,
  };
  const state = environment.HERDR_CONTROL_STATE ?? join(environment.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "herdr-control/control.db");
  const destination = directory ?? join(dirname(state), "capture");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const pending = join(destination, `${randomUUID()}.tmp`);
  writeFileSync(pending, JSON.stringify(event), { mode: 0o600 });
  renameSync(pending, join(destination, `${timestamp.replace(/[^0-9]/g, "")}-${eventId}.json`));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const payload = JSON.parse(process.argv[4] ?? readFileSync(0, "utf8"));
    capture(process.argv[2], payload, process.env, process.argv[3]);
  } catch {
    // Hooks must never block, continue, or otherwise change the agent's turn.
    process.stderr.write("Herdr Control could not capture this message.\n");
  } finally {
    // A neutral JSON response satisfies Codex's hook protocol without directing the turn.
    process.stdout.write("{}\n");
  }
}
