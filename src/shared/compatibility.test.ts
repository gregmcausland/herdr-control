import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { CONTROL_VERSION, herdrProtocolCompatibilityMessage } from "./compatibility";

describe("Herdr protocol compatibility", () => {
  it("accepts the tested range and explains versions outside it", () => {
    expect(CONTROL_VERSION).toBe(packageJson.version);
    expect(herdrProtocolCompatibilityMessage(19)).toBeUndefined();
    expect(herdrProtocolCompatibilityMessage(20)).toBeUndefined();
    expect(herdrProtocolCompatibilityMessage(21)).toContain("supports 19-20");
  });
});
