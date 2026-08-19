import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_CLIPBOARD_IMAGE_BYTES = 16 * 1024 * 1024;

const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const IMAGE_TYPES = {
  "image/png": {
    extension: "png",
    matches: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (data: Buffer) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  "image/gif": {
    extension: "gif",
    matches: (data: Buffer) => data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a",
  },
  "image/webp": {
    extension: "webp",
    matches: (data: Buffer) => data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP",
  },
  "image/bmp": {
    extension: "bmp",
    matches: (data: Buffer) => data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d,
  },
} satisfies Record<string, { extension: string; matches: (data: Buffer) => boolean }>;

export class ClipboardImageError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export class ClipboardImageStore {
  constructor(
    private readonly directory = join(
      tmpdir(),
      `herdr-control-images-${typeof process.getuid === "function" ? process.getuid() : process.pid}`,
    ),
  ) {}

  async stage(contentType: string | undefined, data: Buffer): Promise<string> {
    if (data.length === 0) throw new ClipboardImageError("Clipboard image is empty", 400);
    if (data.length > MAX_CLIPBOARD_IMAGE_BYTES) {
      throw new ClipboardImageError("Clipboard image exceeds the 16 MiB limit", 413);
    }

    const normalizedType = contentType?.split(";", 1)[0].trim().toLowerCase();
    const imageType = normalizedType ? IMAGE_TYPES[normalizedType as keyof typeof IMAGE_TYPES] : undefined;
    if (!imageType) throw new ClipboardImageError("Unsupported clipboard image type", 415);
    if (!imageType.matches(data)) throw new ClipboardImageError("Clipboard image data does not match its type", 400);

    await this.ensureDirectory();
    await this.cleanupStale();

    const path = join(this.directory, `clipboard-${Date.now()}-${randomUUID()}.${imageType.extension}`);
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return path;
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Clipboard image staging path is not a directory: ${this.directory}`);
    }
    await chmod(this.directory, 0o700);
  }

  private async cleanupStale(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const path = join(this.directory, entry.name);
      try {
        const metadata = await stat(path);
        if (Date.now() - metadata.mtimeMs > MAX_AGE_MS) await rm(path);
      } catch {
        // Another upload or cleanup may have removed the file already.
      }
    }));
  }
}
