import { describe, expect, it } from "vitest";
import {
  environmentFile,
  environmentFromUnit,
  systemdUnit,
} from "./herdr-control.mjs";

describe("managed installation", () => {
  it("generates a user service with explicit runtime paths", () => {
    const unit = systemdUnit({
      projectRoot: "/home/user/Herdr Control",
      nodePath: "/home/user/.local/bin/node",
      environmentPath: "/home/user/.config/herdr-control/environment",
    });

    expect(unit).toContain("WorkingDirectory=/home/user/Herdr\\x20Control");
    expect(unit).toContain('ExecStart="/home/user/.local/bin/node" "/home/user/Herdr Control/dist/server/server/index.js"');
    expect(unit).toContain("EnvironmentFile=-/home/user/.config/herdr-control/environment");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).not.toContain("After=herdr.service");
    expect(unit).not.toContain("Wants=network-online.target");
  });

  it("preserves Control settings from an existing service", () => {
    const inherited = environmentFromUnit(`
Environment=NODE_ENV=production
Environment=HERDR_CONTROL_BIN=/home/user/.local/bin/herdr
Environment=HERDR_CONTROL_ALLOWED_ORIGINS=https://first.example,https://second.example
`);

    expect(inherited).toEqual({
      HERDR_CONTROL_BIN: "/home/user/.local/bin/herdr",
      HERDR_CONTROL_ALLOWED_ORIGINS: "https://first.example,https://second.example",
    });
    expect(environmentFile(inherited)).toBe(
      'HERDR_CONTROL_ALLOWED_ORIGINS="https://first.example,https://second.example"\n'
      + 'HERDR_CONTROL_BIN="/home/user/.local/bin/herdr"\n',
    );
  });
});
