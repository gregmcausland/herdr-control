import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ControlHostConflictError,
  ControlHostStore,
  readLegacyControlHosts,
} from "./control-hosts";

describe("ControlHostStore", () => {
  it("imports legacy hosts once without overwriting newer database labels", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-host-store-"));
    const path = join(directory, "control.db");
    let nextId = 0;
    try {
      const store = new ControlHostStore({
        path,
        legacyHosts: [
          { label: "Server MZ", url: "https://server.example/" },
          { label: "Alien MZ", url: "alien.example" },
        ],
        now: () => "2026-08-25T00:00:00.000Z",
        createId: () => `host-${++nextId}`,
      });

      expect(store.list().map(({ label, url }) => ({ label, url }))).toEqual([
        { label: "Alien MZ", url: "https://alien.example" },
        { label: "Server MZ", url: "https://server.example" },
      ]);
      const server = store.list().find((host) => host.label === "Server MZ")!;
      store.update(server.host_id, { label: "Home", url: server.url });
      store.close();

      const reopened = new ControlHostStore({
        path,
        legacyHosts: [{ label: "Old label", url: "https://server.example" }],
      });
      expect(reopened.list().map(({ label, url }) => ({ label, url }))).toEqual([
        { label: "Alien MZ", url: "https://alien.example" },
        { label: "Home", url: "https://server.example" },
      ]);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds, updates, rejects duplicate URLs, and deletes hosts", () => {
    let nextId = 0;
    const store = new ControlHostStore({ path: ":memory:", createId: () => `host-${++nextId}` });
    const first = store.add({ label: " First ", url: "first.example" });
    const second = store.add({ label: "Second", url: "https://second.example/" });

    expect(first).toMatchObject({ host_id: "host-1", label: "First", url: "https://first.example" });
    expect(() => store.add({ label: "Duplicate", url: first.url })).toThrow(ControlHostConflictError);
    expect(store.update(second.host_id, { label: "Renamed", url: "second.example" })).toMatchObject({
      label: "Renamed",
      url: "https://second.example",
    });

    store.delete(first.host_id);
    expect(store.list().map((host) => host.label)).toEqual(["Renamed"]);
    store.close();
  });

  it("reads the complete legacy file or fails without returning partial data", () => {
    const directory = mkdtempSync(join(tmpdir(), "herdr-control-hosts-"));
    const path = join(directory, "hosts.json");
    try {
      writeFileSync(path, JSON.stringify([{ label: "Home", url: "home.example" }]));
      expect(readLegacyControlHosts(path)).toEqual([{ label: "Home", url: "home.example" }]);

      writeFileSync(path, JSON.stringify([
        { label: "Home", url: "home.example" },
        { label: "Broken" },
      ]));
      expect(() => readLegacyControlHosts(path)).toThrow(/requires a label and URL/);
      expect(readFileSync(path, "utf8")).toContain("Broken");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
