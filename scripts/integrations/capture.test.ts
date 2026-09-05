import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capture } from "./capture.mjs";
import { installReplyCapture } from "./install.mjs";
import { collectReplies } from "../../src/server/capture";
import { ConversationStore } from "../../src/server/conversations";
import { ThreadManager } from "../../src/server/threads";

describe("host reply capture", () => {
  it("imports a reply captured while the bridge was down and does not duplicate a repeated hook", async () => {
    const directory = mkdtempSync(join(tmpdir(), "control-capture-"));
    const threads = new ThreadManager({ path: ":memory:" });
    const conversations = new ConversationStore(":memory:");
    const environment = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/tmp/capture.sock" };
    let collector: ReturnType<typeof collectReplies> | undefined;
    try {
      const payload = { hook_event_name: "Stop", session_id: "session-1", turn_id: "turn-1", last_assistant_message: "## Result\nIt works." };
      const result = execFileSync(process.execPath, [fileURLToPath(new URL("./capture.mjs", import.meta.url)), "codex", directory], {
        input: JSON.stringify(payload), encoding: "utf8", env: environment,
      });
      expect(JSON.parse(result)).toEqual({});
      expect(readdirSync(directory).filter((name) => name.endsWith(".json"))).toHaveLength(1);
      const projected = threads.reconcile({ version: "test", protocol: 19, workspaces: [], tabs: [], panes: [{
        pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "terminal-1", agent: "codex", focused: false,
        agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "session-1" },
      }] });
      collector = collectReplies(directory, environment.HERDR_SOCKET_PATH, threads, conversations);
      await collector.refresh();
      capture("codex", payload, environment, directory);
      await collector.refresh();
      expect(conversations.list(projected.threads![0].thread_id).messages.map((message) => message.text)).toEqual(["## Result\nIt works."]);
      expect(readdirSync(directory)).toEqual([]);
    } finally { await collector?.close(); conversations.close(); threads.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("preserves unrelated hooks and installs idempotently into isolated agent homes", () => {
    const home = mkdtempSync(join(tmpdir(), "control-hook-install-"));
    try {
      mkdirSync(join(home, ".codex"));
      writeFileSync(join(home, ".codex/hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook" }] }] } }));
      const environment = { HERDR_CONTROL_STATE: join(home, "state/control.db") };
      installReplyCapture(environment, home);
      installReplyCapture(environment, home);
      const hooks = JSON.parse(readFileSync(join(home, ".codex/hooks.json"), "utf8")).hooks;
      expect(hooks.Stop.flatMap((entry: any) => entry.hooks)).toHaveLength(2);
      expect(hooks.Stop[0].hooks[0].command).toBe("existing-hook");
      expect(hooks.UserPromptSubmit).toHaveLength(1);
      expect(readFileSync(join(home, ".pi/agent/extensions/herdr-control/index.ts"), "utf8")).toContain("agent_settled");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("does not capture subagents or agents outside Herdr", () => {
    const directory = mkdtempSync(join(tmpdir(), "control-hook-filter-"));
    try {
      const payload = { hook_event_name: "Stop", session_id: "session-1", last_assistant_message: "Hello" };
      capture("claude", payload, {}, directory);
      capture("claude", { ...payload, agent_id: "child" }, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/tmp/herdr.sock" }, directory);
      expect(readdirSync(directory)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
