import { useEffect, useState } from "react";
import type { SessionFeedState } from "../shared/protocol";

const INITIAL_STATE: SessionFeedState = { status: "connecting", revision: 0 };

/** Adapts the bridge's shared session feed into browser state. */
export function useLiveSession(bridgeUrl: string): SessionFeedState {
  const [state, setState] = useState<SessionFeedState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);
    const source = new EventSource(new URL("/api/session/events", bridgeUrl));
    source.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as SessionFeedState;
        if (
          (incoming.status !== "connecting" && incoming.status !== "live" && incoming.status !== "stale")
          || !Number.isInteger(incoming.revision)
        ) {
          throw new Error("Invalid live session state");
        }
        setState(incoming);
      } catch {
        setState((current) => ({
          ...current,
          status: "stale",
          message: "The bridge sent invalid live session state",
        }));
      }
    };
    source.onerror = () => {
      setState((current) => ({
        ...current,
        status: "stale",
        message: current.message ?? "Live connection interrupted; reconnecting…",
      }));
    };

    return () => source.close();
  }, [bridgeUrl]);

  return state;
}
