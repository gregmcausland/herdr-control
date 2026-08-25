import { describe, expect, it } from "vitest";
import type { SessionFeedState, SessionSnapshot } from "../shared/protocol";
import type { ControlHost } from "./hosts";
import {
  connectHostSessionFeeds,
  type OpenSessionFeed,
  type SessionFeedSource,
} from "./host-session-feeds";

const hosts = [
  { label: "First", url: "https://first.example" },
  { label: "Second", url: "https://second.example" },
] satisfies readonly ControlHost[];

class FakeSource implements SessionFeedSource {
  closed = false;
  private messageListener: (data: string) => void = () => undefined;
  private errorListener: () => void = () => undefined;

  onMessage(listener: (data: string) => void): void {
    this.messageListener = listener;
  }

  onError(listener: () => void): void {
    this.errorListener = listener;
  }

  close(): void {
    this.closed = true;
  }

  emit(state: SessionFeedState): void {
    this.messageListener(JSON.stringify(state));
  }

  emitRaw(data: string): void {
    this.messageListener(data);
  }

  fail(): void {
    this.errorListener();
  }
}

function snapshot(version: string): SessionSnapshot {
  return {
    version,
    protocol: 19,
    workspaces: [],
    tabs: [],
    panes: [],
  };
}

function fakeFeeds() {
  const sources = new Map<string, FakeSource[]>();
  const open: OpenSessionFeed = (url) => {
    const source = new FakeSource();
    const hostSources = sources.get(url.host) ?? [];
    hostSources.push(source);
    sources.set(url.host, hostSources);
    return source;
  };
  return { sources, open };
}

describe("host session feeds", () => {
  it("keeps the healthy host live when another host disconnects", () => {
    const feeds = fakeFeeds();
    let current: Readonly<Record<string, SessionFeedState>> = {};
    connectHostSessionFeeds(hosts, (states) => current = states, feeds.open);

    const first = feeds.sources.get("first.example")![0];
    const second = feeds.sources.get("second.example")![0];
    first.emit({ status: "live", revision: 1, snapshot: snapshot("first") });
    second.emit({ status: "live", revision: 4, snapshot: snapshot("second") });
    first.fail();

    expect(current[hosts[0].url]).toMatchObject({
      status: "stale",
      revision: 1,
      snapshot: { version: "first" },
    });
    expect(current[hosts[1].url]).toMatchObject({
      status: "live",
      revision: 4,
      snapshot: { version: "second" },
    });
  });

  it("rejects one host's invalid message without discarding its last snapshot", () => {
    const feeds = fakeFeeds();
    let current: Readonly<Record<string, SessionFeedState>> = {};
    connectHostSessionFeeds(hosts, (states) => current = states, feeds.open);

    const first = feeds.sources.get("first.example")![0];
    const second = feeds.sources.get("second.example")![0];
    first.emit({ status: "live", revision: 2, snapshot: snapshot("first") });
    second.emit({ status: "live", revision: 3, snapshot: snapshot("second") });
    first.emitRaw("not json");

    expect(current[hosts[0].url]).toMatchObject({
      status: "stale",
      revision: 2,
      message: "The bridge sent invalid live session state",
      snapshot: { version: "first" },
    });
    expect(current[hosts[1].url].status).toBe("live");
  });

  it("ignores messages from connections replaced during a reconnect", () => {
    const feeds = fakeFeeds();
    let current: Readonly<Record<string, SessionFeedState>> = {};
    const controller = connectHostSessionFeeds(hosts, (states) => current = states, feeds.open);
    const oldFirst = feeds.sources.get("first.example")![0];

    controller.reconnect();
    const newFirst = feeds.sources.get("first.example")![1];
    expect(oldFirst.closed).toBe(true);

    oldFirst.emit({ status: "live", revision: 99, snapshot: snapshot("old") });
    newFirst.emit({ status: "live", revision: 1, snapshot: snapshot("new") });

    expect(current[hosts[0].url]).toMatchObject({
      revision: 1,
      snapshot: { version: "new" },
    });
  });

  it("continues opening hosts when one connection cannot be created", () => {
    const feeds = fakeFeeds();
    let current: Readonly<Record<string, SessionFeedState>> = {};
    const open: OpenSessionFeed = (url) => {
      if (url.host === "first.example") throw new Error("offline");
      return feeds.open(url);
    };

    connectHostSessionFeeds(hosts, (states) => current = states, open);
    const second = feeds.sources.get("second.example")![0];
    second.emit({ status: "live", revision: 1, snapshot: snapshot("second") });

    expect(current[hosts[0].url]).toMatchObject({
      status: "stale",
      message: "Unable to open the live connection",
    });
    expect(current[hosts[1].url]).toMatchObject({
      status: "live",
      snapshot: { version: "second" },
    });
  });

  it("reports one incompatible host without replacing its last compatible snapshot", () => {
    const feeds = fakeFeeds();
    let current: Readonly<Record<string, SessionFeedState>> = {};
    connectHostSessionFeeds(hosts, (states) => current = states, feeds.open);

    const first = feeds.sources.get("first.example")![0];
    const second = feeds.sources.get("second.example")![0];
    first.emit({ status: "live", revision: 1, snapshot: snapshot("first") });
    second.emit({ status: "live", revision: 1, snapshot: snapshot("second") });
    first.emit({
      status: "live",
      revision: 2,
      snapshot: { ...snapshot("future"), protocol: 21 },
    });

    expect(current[hosts[0].url]).toMatchObject({
      status: "stale",
      revision: 2,
      message: "Unsupported Herdr protocol 21; this Control release supports 19-20",
      snapshot: { version: "first", protocol: 19 },
    });
    expect(current[hosts[1].url]).toMatchObject({
      status: "live",
      snapshot: { version: "second" },
    });
  });
});
