import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const assets = dirname(fileURLToPath(import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Adds independent hooks, preserving Herdr integrations and all unrelated settings. */
export function installReplyCapture(environment = process.env, home = homedir()) {
  const state = environment.HERDR_CONTROL_STATE ?? join(environment.XDG_STATE_HOME ?? join(home, ".local/state"), "herdr-control/control.db");
  const target = join(dirname(state), "integrations");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  copyFileSync(join(assets, "capture.mjs"), join(target, "capture.mjs"));
  const spool = join(dirname(state), "capture");
  for (const [agent, path] of [
    ["codex", join(environment.CODEX_HOME ?? join(home, ".codex"), "hooks.json")],
    ["claude", join(environment.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json")],
  ]) {
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    settings.hooks ??= {};
    for (const event of ["UserPromptSubmit", "Stop"]) {
      const entries = settings.hooks[event] ?? [];
      const command = [process.execPath, join(target, "capture.mjs"), agent, spool].map(quote).join(" ");
      settings.hooks[event] = entries.map((entry) => ({ ...entry, hooks: entry.hooks.filter((hook) => !hook.command?.includes("/integrations/capture.mjs")) }))
        .filter((entry) => entry.hooks.length);
      settings.hooks[event].push({ hooks: [{ type: "command", command, timeout: 5 }] });
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) copyFileSync(path, `${path}.before-control-${Date.now()}`);
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  }
  const piDirectory = join(environment.PI_CODING_AGENT_DIR ?? join(home, ".pi/agent"), "extensions/herdr-control");
  mkdirSync(piDirectory, { recursive: true, mode: 0o700 });
  // The explicit destination also works when the agent was launched outside Control.
  const captureCode = readFileSync(join(assets, "capture.mjs"), "utf8").replace('const destination = directory ?? join(dirname(state), "capture");', `const destination = directory ?? ${JSON.stringify(spool)};`);
  writeFileSync(join(piDirectory, "capture.mjs"), captureCode, { mode: 0o600 });
  copyFileSync(join(assets, "pi.ts"), join(piDirectory, "index.ts"));
  return { spool, target, piDirectory };
}
