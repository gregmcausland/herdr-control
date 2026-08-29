import { useEffect, useState } from "react";
import { AGENT_KINDS, isKnownAgentKind, type KnownAgentKind } from "../shared/agents";
import type { ControlHost } from "./hosts";

export type HostAgentInventory =
  | { status: "loading"; agents: readonly [] }
  | { status: "ready"; agents: readonly KnownAgentKind[] }
  | { status: "error"; agents: readonly []; message: string };

const LOADING: HostAgentInventory = { status: "loading", agents: [] };

/** Loads each bridge's launchable agent inventory without coupling it to the live session feed. */
export function useHostAgentInventories(
  hosts: readonly ControlHost[],
): Readonly<Record<string, HostAgentInventory>> {
  const [inventories, setInventories] = useState<Record<string, HostAgentInventory>>({});

  useEffect(() => {
    const controller = new AbortController();
    setInventories(Object.fromEntries(hosts.map((host) => [host.url, LOADING])));

    const load = () => {
      for (const host of hosts) {
        void requestHostAgents(host.url, controller.signal).then((agents) => {
          setInventories((current) => ({
            ...current,
            [host.url]: { status: "ready", agents },
          }));
        }).catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setInventories((current) => current[host.url]?.status === "ready"
            ? current
            : {
                ...current,
                [host.url]: {
                  status: "error",
                  agents: [],
                  message: error instanceof Error ? error.message : "Unable to load host agents",
                },
              });
        });
      }
    };
    const loadWhenVisible = () => {
      if (!document.hidden) load();
    };
    const loadFromPageCache = (event: PageTransitionEvent) => {
      if (event.persisted) load();
    };

    load();
    document.addEventListener("visibilitychange", loadWhenVisible);
    window.addEventListener("pageshow", loadFromPageCache);
    window.addEventListener("online", load);

    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", loadWhenVisible);
      window.removeEventListener("pageshow", loadFromPageCache);
      window.removeEventListener("online", load);
    };
  }, [hosts]);

  return inventories;
}

export async function requestHostAgents(
  hostUrl: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<KnownAgentKind[]> {
  const response = await request(`${hostUrl}/api/agents`, { signal });
  const body = await response.json().catch(() => undefined) as { agents?: unknown; error?: string } | undefined;
  // Keep mixed-version hosts usable while bridges are upgraded one at a time.
  if (response.status === 404) return AGENT_KINDS.map(({ kind }) => kind);
  if (!response.ok) throw new Error(body?.error ?? `Unable to load host agents (${response.status})`);
  if (!Array.isArray(body?.agents) || !body.agents.every((agent) => typeof agent === "string" && isKnownAgentKind(agent))) {
    throw new Error("The bridge returned an invalid agent inventory");
  }
  return [...new Set(body.agents)];
}
