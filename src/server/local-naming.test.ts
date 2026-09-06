import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NAMING_CONFIG, generateThreadTitle, namingEnvironment, parseThreadTitle, readNamingConfig } from "./local-naming";

const directories: string[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), "naming-test-")); directories.push(path); return path; }
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe("local naming command", () => {
  it("reloads host configuration, defaults off, and rejects malformed settings", async () => {
    const path = join(directory(), "naming.json");
    expect((await readNamingConfig(path)).enabled).toBe(false);
    writeFileSync(path, JSON.stringify({ enabled: true, model: "gpt-5.6-luna" }));
    expect(await readNamingConfig(path)).toMatchObject({ enabled: true, model: "gpt-5.6-luna" });
    writeFileSync(path, JSON.stringify({ enabled: true, model: "another-model" }));
    expect((await readNamingConfig(path)).model).toBe("another-model");
    writeFileSync(path, JSON.stringify({ timeoutMs: -1 }));
    await expect(readNamingConfig(path)).rejects.toThrow("Invalid naming configuration");
  });

  it("excludes voice/API credentials and parent integration context but preserves saved CLI login location", () => {
    expect(namingEnvironment({ OPENAI_API_KEY: "voice", CODEX_API_KEY: "other", OPENAI_BASE_URL: "custom",
      HERDR_PANE_ID: "p1", PI_SESSION: "parent", CODEX_THREAD_ID: "parent", CODEX_HOME: "/saved-login", PATH: "/bin", HOME: "/home/user" }))
      .toEqual({ CODEX_HOME: "/saved-login", PATH: "/bin", HOME: "/home/user" });
  });

  it("passes bounded task data over stdin and preserves literal args", async () => {
    const script = join(directory(), "fake-cli.mjs");
    writeFileSync(script, `let input = ''; for await (const chunk of process.stdin) input += chunk;
      if (process.argv[2] !== 'literal $(false); gpt-5.6-luna') process.exit(2);
      if (input.length > 2600 || !input.includes('Task:')) process.exit(3);
      process.stdout.write(JSON.stringify({label:'Improve voice recording'}));`);
    await expect(generateThreadTitle("x".repeat(5000), { ...DEFAULT_NAMING_CONFIG, executable: process.execPath,
      args: [script, "literal $(false); {model}"] })).resolves.toBe("Improve voice recording");
  });

  it("requires saved ChatGPT auth and isolates the default Codex invocation", async () => {
    const executable = join(directory(), "codex");
    writeFileSync(executable, `#!/usr/bin/env node
      const args = process.argv.slice(2);
      for (const required of ['exec', '--ignore-user-config', '--ephemeral', 'read-only', 'gpt-5.6-luna', 'forced_login_method="chatgpt"']) {
        if (!args.includes(required)) process.exit(2);
      }
      if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.HERDR_PANE_ID) process.exit(3);
      if (!process.cwd().includes('herdr-control-naming-')) process.exit(4);
      process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('{"label":"Voice feedback"}'));`);
    chmodSync(executable, 0o700);
    await expect(generateThreadTitle("Voice feedback", { ...DEFAULT_NAMING_CONFIG, executable }))
      .resolves.toBe("Voice feedback");
  });

  it("terminates a stuck command and rejects excess output", async () => {
    await expect(generateThreadTitle("test", { ...DEFAULT_NAMING_CONFIG, executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 60 })).rejects.toThrow("timed out");
    await expect(generateThreadTitle("test", { ...DEFAULT_NAMING_CONFIG, executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(20000))"] })).rejects.toThrow("exceeded");
    await expect(generateThreadTitle("test", { ...DEFAULT_NAMING_CONFIG, executable: "/missing/naming-command" }))
      .rejects.toThrow("Unable to start");
  });

  it("accepts only a short plain label", () => {
    for (const output of ['{}', '{"label":""}', '{"label":"one\\ntwo"}', JSON.stringify({ label: "x".repeat(81) }), 'not JSON']) {
      expect(() => parseThreadTitle(output)).toThrow();
    }
  });
});
