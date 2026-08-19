import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  SessionSnapshot,
  TerminalClientMessage,
  TerminalMode,
  TerminalServerMessage,
} from "../shared/protocol.js";
import { requestHerdr } from "./herdr-socket.js";

interface HerdrFrame {
  type: "terminal.frame";
  seq: number;
  width: number;
  height: number;
  full: boolean;
  bytes: string;
}

interface HerdrClosed {
  type: "terminal.closed";
  reason?: string;
}

type HerdrRecord = HerdrFrame | HerdrClosed;

export function translateHerdrRecord(record: HerdrRecord): TerminalServerMessage {
  if (record.type === "terminal.frame") {
    return {
      type: "frame",
      seq: record.seq,
      cols: record.width,
      rows: record.height,
      full: record.full,
      data: record.bytes,
    };
  }

  const reason = record.reason ?? "Herdr closed the terminal session";
  if (reason.includes("already has an attached client")) {
    return { type: "occupied", message: reason };
  }
  return { type: "closed", reason };
}

const LEGACY_KEYS: Record<string, string> = {
  "\r": "enter",
  "\x1b": "esc",
  "\x03": "ctrl+c",
  "\t": "tab",
  "\x7f": "backspace",
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1bOA": "up",
  "\x1bOB": "down",
  "\x1bOC": "right",
  "\x1bOD": "left",
  "\x1b[3~": "delete",
  "\x1b[H": "home",
  "\x1b[F": "end",
};

export function logicalKeyFromLegacyInput(data: string): string | undefined {
  return LEGACY_KEYS[data];
}

export class HerdrTerminalConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private stderr = "";
  private receivedClose = false;
  private disposed = false;
  private keyQueue: Promise<unknown> = Promise.resolve();

  constructor(
    binary: string,
    private readonly socketPath: string,
    private readonly target: string,
    mode: TerminalMode,
    takeover: boolean,
    cols: number,
    rows: number,
    private readonly emit: (message: TerminalServerMessage) => void,
  ) {
    const args = ["terminal", "session", mode, target, "--cols", String(cols), "--rows", String(rows)];
    if (mode === "control" && takeover) args.push("--takeover");

    this.child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });

    lines.on("line", (line) => {
      try {
        const message = translateHerdrRecord(JSON.parse(line) as HerdrRecord);
        if (message.type === "closed" || message.type === "occupied") this.receivedClose = true;
        this.emit(message);
      } catch {
        this.emit({ type: "error", message: "Herdr emitted an invalid terminal record" });
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8_192);
    });
    this.child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // Herdr may close immediately after release or takeover. The ownership is
      // already gone, so a racing detach write has nothing left to accomplish.
      if (error.code !== "EPIPE") {
        this.emit({ type: "error", message: `Herdr terminal input failed: ${error.message}` });
      }
    });

    this.child.on("error", (error) => {
      this.emit({ type: "error", message: `Unable to start Herdr: ${error.message}` });
    });

    this.child.on("close", (code) => {
      if (this.disposed || this.receivedClose) return;
      const detail = this.stderr.trim();
      this.emit({
        type: "closed",
        reason: detail || `Herdr terminal process exited${code === null ? "" : ` with code ${code}`}`,
      });
    });
  }

  send(message: TerminalClientMessage): void {
    if (this.disposed || !this.child.stdin.writable) return;

    const logicalKey = message.type === "key"
      ? message.key
      : message.type === "input"
        ? logicalKeyFromLegacyInput(message.data)
        : undefined;
    if (logicalKey) {
      this.queueKey(logicalKey);
    } else if (message.type === "input") {
      this.write({ type: "terminal.input", text: message.data });
    } else if (message.type === "resize") {
      this.write({ type: "terminal.resize", cols: message.cols, rows: message.rows });
    } else if (message.type === "scroll") {
      this.write({
        type: "terminal.scroll",
        source: message.source,
        direction: message.direction,
        lines: message.lines,
        column: message.column,
        row: message.row,
      });
    } else {
      this.write({ type: "terminal.release" });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.child.stdin.writable) {
      this.write({ type: "terminal.release" });
      this.child.stdin.end();
    }
    const timer = setTimeout(() => this.child.kill(), 1_000);
    timer.unref();
  }

  private write(message: object): void {
    if (this.child.exitCode !== null || this.child.stdin.destroyed || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private queueKey(key: string): void {
    this.keyQueue = this.keyQueue
      .then(() => requestHerdr(this.socketPath, "pane.send_keys", {
        pane_id: this.target,
        keys: [key],
      }))
      .catch((error: unknown) => {
        this.emit({
          type: "error",
          message: error instanceof Error ? error.message : "Herdr rejected terminal input",
        });
      });
  }
}

export class HerdrAdapter {
  constructor(
    private readonly binary = "herdr",
    private readonly socketPath = "",
  ) {}

  async snapshot(): Promise<SessionSnapshot> {
    const stdout = await this.run(["api", "snapshot"]);
    const response = JSON.parse(stdout) as { result?: { snapshot?: SessionSnapshot }; error?: { message?: string } };
    const snapshot = response.result?.snapshot;
    if (!snapshot) throw new Error(response.error?.message ?? "Herdr returned no session snapshot");
    return snapshot;
  }

  connectTerminal(
    options: {
      target: string;
      mode: TerminalMode;
      takeover: boolean;
      cols: number;
      rows: number;
    },
    emit: (message: TerminalServerMessage) => void,
  ): HerdrTerminalConnection {
    return new HerdrTerminalConnection(
      this.binary,
      this.socketPath,
      options.target,
      options.mode,
      options.takeover,
      options.cols,
      options.rows,
      emit,
    );
  }

  async focusPane(target: string): Promise<void> {
    await requestHerdr(this.socketPath, "pane.focus", { pane_id: target });
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `Herdr exited with code ${code}`));
      });
    });
  }
}
