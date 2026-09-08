import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn() };
});

import { HerdrTerminalConnection } from "./herdr";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  exitCode: number | null = null;
  kill = vi.fn(() => {
    this.exitCode = 0;
    queueMicrotask(() => this.emit("close", 0));
    return true;
  });
}

describe("Herdr terminal process", () => {
  const spawnMock = vi.mocked(spawn);

  beforeEach(() => spawnMock.mockReset());

  it("pins the subprocess to the configured Herdr socket", () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as never);

    const terminal = new HerdrTerminalConnection(
      "herdr",
      "/tmp/named-session.sock",
      "w1:p1",
      "control",
      false,
      80,
      24,
      () => undefined,
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "herdr",
      ["terminal", "session", "control", "w1:p1", "--cols", "80", "--rows", "24"],
      expect.objectContaining({
        env: expect.objectContaining({ HERDR_SOCKET_PATH: "/tmp/named-session.sock" }),
      }),
    );
    terminal.dispose();
  });

  it("stops a read-only observer instead of writing an unsupported release record", async () => {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as never);
    const terminal = new HerdrTerminalConnection(
      "herdr",
      "/tmp/herdr.sock",
      "w1:p1",
      "observe",
      false,
      80,
      24,
      () => undefined,
    );

    const released = terminal.release();

    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.stdin.readableLength).toBe(0);
    await expect(released).resolves.toBeUndefined();
  });
});
