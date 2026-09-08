import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { CONTROL_VERSION } from "./compatibility";

describe("Control compatibility metadata", () => {
  it("matches the package version", () => {
    expect(CONTROL_VERSION).toBe(packageJson.version);
  });
});
