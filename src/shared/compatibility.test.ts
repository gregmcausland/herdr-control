import { describe, expect, it } from "vitest";
import { herdrProtocolCompatibilityMessage } from "./compatibility";

describe("Herdr protocol compatibility", () => {
  it("accepts the tested range and explains versions outside it", () => {
    expect(herdrProtocolCompatibilityMessage(19)).toBeUndefined();
    expect(herdrProtocolCompatibilityMessage(20)).toBeUndefined();
    expect(herdrProtocolCompatibilityMessage(21)).toContain("supports 19-20");
  });
});
