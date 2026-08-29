import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { AGENT_KINDS, type KnownAgentKind } from "../shared/agents.js";

export type ExecutableProbe = (executable: string) => Promise<boolean>;

/** Reports the Control-supported agents whose launch commands resolve on this bridge host. */
export async function discoverAvailableAgentKinds(
  probe: ExecutableProbe = executableIsOnPath,
): Promise<KnownAgentKind[]> {
  const checks = await Promise.all(AGENT_KINDS.map(async (agent) => ({
    kind: agent.kind,
    available: await probe(agent.executable).catch(() => false),
  })));
  return checks.filter((check) => check.available).map((check) => check.kind);
}

async function executableIsOnPath(executable: string): Promise<boolean> {
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      try {
        await access(join(directory, `${executable}${extension.toLowerCase()}`), constants.X_OK);
        return true;
      } catch {
        // Keep searching the host PATH.
      }
    }
  }
  return executableIsInUserShell(executable);
}

/** Herdr starts agents inside the user's interactive shell, whose PATH may differ from systemd's. */
function executableIsInUserShell(executable: string): Promise<boolean> {
  const shell = process.env.SHELL?.trim();
  if (!shell) return Promise.resolve(false);

  return new Promise((resolve) => {
    const child = spawn(shell, ["-lic", 'command -v -- "$HERDR_CONTROL_AGENT" >/dev/null 2>&1'], {
      env: { ...process.env, HERDR_CONTROL_AGENT: executable },
      stdio: "ignore",
    });
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(available);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, 5_000);
    timeout.unref();
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}
