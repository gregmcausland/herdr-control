import { chmod, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClipboardImageError, ClipboardImageStore, MAX_CLIPBOARD_IMAGE_BYTES } from "./clipboard-image";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const directories: string[] = [];

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "herdr-control-image-test-"));
  directories.push(directory);
  return { directory, store: new ClipboardImageStore(directory) };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ClipboardImageStore", () => {
  it("stages a validated image with private permissions", async () => {
    const target = await store();
    const path = await target.store.stage("image/png", PNG_HEADER);

    expect(await readFile(path)).toEqual(PNG_HEADER);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(target.directory)).mode & 0o777).toBe(0o700);
  });

  it("rejects unsupported, mismatched, and oversized image data", async () => {
    const target = await store();

    await expect(target.store.stage("text/plain", PNG_HEADER)).rejects.toMatchObject({ statusCode: 415 });
    await expect(target.store.stage("image/png", Buffer.from("not an image"))).rejects.toMatchObject({ statusCode: 400 });
    await expect(target.store.stage("image/png", Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 1))).rejects.toBeInstanceOf(ClipboardImageError);
  });

  it("removes staged files older than 24 hours on the next upload", async () => {
    const target = await store();
    const stalePath = join(target.directory, "stale.png");
    await writeFile(stalePath, PNG_HEADER);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(stalePath, old, old);
    await chmod(target.directory, 0o755);

    await target.store.stage("image/png", PNG_HEADER);

    await expect(stat(stalePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
