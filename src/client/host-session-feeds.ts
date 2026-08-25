import type { SessionFeedState } from "../shared/protocol";
import type { ControlHost } from "./hosts";

const INITIAL_STATE: SessionFeedState = { status: "connecting", revision: 0 };

export interface SessionFeedSource {
  onMessage(listener: (data: string) => void): void;
  onError(listener: () => void): void;
  close(): void;
}

export type OpenSessionFeed = (url: URL) => SessionFeedSource;

interface SessionFeedController {
  reconnect(): void;
  close(): void;
}

/** Keeps every host's connection and last valid snapshot independent. */
export function connectHostSessionFeeds(
  hosts: readonly ControlHost[],
  publish: (states: Readonly<Record<string, SessionFeedState>>) => void,
  openSource: OpenSessionFeed = openBrowserSessionFeed,
): SessionFeedController {
  let generation = 0;
  let sources: SessionFeedSource[] = [];
  let states = initialHostSessionStates(hosts);

  const update = (
    hostUrl: string,
    change: (current: SessionFeedState) => SessionFeedState,
  ) => {
    states = { ...states, [hostUrl]: change(states[hostUrl] ?? INITIAL_STATE) };
    publish(states);
  };

  const reconnect = () => {
    generation += 1;
    const sourceGeneration = generation;
    sources.forEach((source) => source.close());
    sources = [];

    for (const host of hosts) {
      try {
        const source = openSource(new URL("/api/session/events", host.url));
        sources.push(source);
        source.onMessage((data) => {
          if (sourceGeneration !== generation) return;
          const incoming = parseSessionFeedState(data);
          if (incoming) {
            update(host.url, () => incoming);
            return;
          }
          update(host.url, (current) => ({
            ...current,
            status: "stale",
            message: "The bridge sent invalid live session state",
          }));
        });
        source.onError(() => {
          if (sourceGeneration !== generation) return;
          update(host.url, (current) => ({
            ...current,
            status: "stale",
            message: current.message ?? "Live connection interrupted; reconnecting…",
          }));
        });
      } catch {
        update(host.url, (current) => ({
          ...current,
          status: "stale",
          message: "Unable to open the live connection",
        }));
      }
    }
  };

  publish(states);
  reconnect();

  return {
    reconnect,
    close() {
      generation += 1;
      sources.forEach((source) => source.close());
      sources = [];
    },
  };
}

function initialHostSessionStates(
  hosts: readonly ControlHost[],
): Record<string, SessionFeedState> {
  return Object.fromEntries(hosts.map((host) => [host.url, INITIAL_STATE]));
}

function parseSessionFeedState(data: string): SessionFeedState | undefined {
  try {
    const incoming = JSON.parse(data) as SessionFeedState;
    if (
      (incoming.status !== "connecting" && incoming.status !== "live" && incoming.status !== "stale")
      || !Number.isInteger(incoming.revision)
    ) {
      return undefined;
    }
    return incoming;
  } catch {
    return undefined;
  }
}

function openBrowserSessionFeed(url: URL): SessionFeedSource {
  const source = new EventSource(url);
  return {
    onMessage(listener) {
      source.onmessage = (event) => listener(event.data);
    },
    onError(listener) {
      source.onerror = listener;
    },
    close() {
      source.close();
    },
  };
}
