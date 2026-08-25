import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { SessionFeedState } from "../shared/protocol";
import type { ControlHost } from "./hosts";

const INITIAL_STATE: SessionFeedState = { status: "connecting", revision: 0 };

export interface HostSessionFeed extends SessionFeedState {
  host: ControlHost;
}

/** Maintains one independent bridge feed for every configured Herdr host. */
export function useLiveSessions(hosts: readonly ControlHost[]): readonly HostSessionFeed[] {
  const [states, setStates] = useState<Record<string, SessionFeedState>>(() => initialStates(hosts));

  useEffect(() => {
    setStates(initialStates(hosts));
    let generation = 0;
    let sources: EventSource[] = [];

    const connect = () => {
      generation += 1;
      const sourceGeneration = generation;
      sources.forEach((source) => source.close());
      sources = hosts.map((host) => {
        const source = new EventSource(new URL("/api/session/events", host.url));
        source.onmessage = (event) => {
          if (sourceGeneration !== generation) return;
          try {
            const incoming = JSON.parse(event.data) as SessionFeedState;
            if (
              (incoming.status !== "connecting" && incoming.status !== "live" && incoming.status !== "stale")
              || !Number.isInteger(incoming.revision)
            ) {
              throw new Error("Invalid live session state");
            }
            updateHostState(setStates, host.url, incoming);
          } catch {
            updateHostState(setStates, host.url, (current) => ({
              ...current,
              status: "stale",
              message: "The bridge sent invalid live session state",
            }));
          }
        };
        source.onerror = () => {
          if (sourceGeneration !== generation) return;
          updateHostState(setStates, host.url, (current) => ({
            ...current,
            status: "stale",
            message: current.message ?? "Live connection interrupted; reconnecting…",
          }));
        };
        return source;
      });
    };
    const reconnectWhenVisible = () => {
      if (!document.hidden) connect();
    };
    const reconnectFromPageCache = (event: PageTransitionEvent) => {
      if (event.persisted) connect();
    };

    connect();
    document.addEventListener("visibilitychange", reconnectWhenVisible);
    window.addEventListener("pageshow", reconnectFromPageCache);
    window.addEventListener("online", reconnectWhenVisible);

    return () => {
      generation += 1;
      sources.forEach((source) => source.close());
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
      window.removeEventListener("pageshow", reconnectFromPageCache);
      window.removeEventListener("online", reconnectWhenVisible);
    };
  }, [hosts]);

  return hosts.map((host) => ({
    host,
    ...(states[host.url] ?? INITIAL_STATE),
  }));
}

function initialStates(hosts: readonly ControlHost[]): Record<string, SessionFeedState> {
  return Object.fromEntries(hosts.map((host) => [host.url, INITIAL_STATE]));
}

function updateHostState(
  setStates: Dispatch<SetStateAction<Record<string, SessionFeedState>>>,
  hostUrl: string,
  update: SessionFeedState | ((current: SessionFeedState) => SessionFeedState),
): void {
  setStates((states) => {
    const current = states[hostUrl] ?? INITIAL_STATE;
    return {
      ...states,
      [hostUrl]: typeof update === "function" ? update(current) : update,
    };
  });
}
