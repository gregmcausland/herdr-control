import { useEffect, useState } from "react";
import type { SessionFeedState } from "../shared/protocol";
import type { ControlHost } from "./hosts";
import { connectHostSessionFeeds } from "./host-session-feeds";

const INITIAL_STATE: SessionFeedState = { status: "connecting", revision: 0 };

export interface HostSessionFeed extends SessionFeedState {
  host: ControlHost;
}

/** Maintains one independent bridge feed for every configured Herdr host. */
export function useLiveSessions(hosts: readonly ControlHost[]): readonly HostSessionFeed[] {
  const [states, setStates] = useState<Record<string, SessionFeedState>>({});

  useEffect(() => {
    const feeds = connectHostSessionFeeds(hosts, (nextStates) => setStates({ ...nextStates }));
    const reconnectWhenVisible = () => {
      if (!document.hidden) feeds.reconnect();
    };
    const reconnectFromPageCache = (event: PageTransitionEvent) => {
      if (event.persisted) feeds.reconnect();
    };

    document.addEventListener("visibilitychange", reconnectWhenVisible);
    window.addEventListener("pageshow", reconnectFromPageCache);
    window.addEventListener("online", reconnectWhenVisible);

    return () => {
      feeds.close();
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
