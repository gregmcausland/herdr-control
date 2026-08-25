import { useEffect, useMemo, useState } from "react";
import type { ControlHost, StoredControlHost } from "../shared/control-hosts";
import { configuredHosts, hostOptions } from "./hosts";

export type ControlHostConfigurationStatus = "loading" | "database" | "fallback";

export interface ControlHostConfiguration {
  hosts: readonly ControlHost[];
  storedHosts: readonly StoredControlHost[];
  status: ControlHostConfigurationStatus;
  message?: string;
  save(host: ControlHost): Promise<void>;
  remove(hostId: string): Promise<void>;
}

/** Loads and edits the Control Host list owned by the Home bridge. */
export function useControlHosts(
  homeBridgeUrl: string,
  activeHostUrl: string,
): ControlHostConfiguration {
  const [storedHosts, setStoredHosts] = useState<readonly StoredControlHost[]>([]);
  const [status, setStatus] = useState<ControlHostConfigurationStatus>("loading");
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let current = true;
    void requestHosts(homeBridgeUrl).then((hosts) => {
      if (!current) return;
      setStoredHosts(hosts);
      setStatus("database");
      setMessage(undefined);
    }).catch((error: unknown) => {
      if (!current) return;
      setStoredHosts([]);
      setStatus("fallback");
      setMessage(error instanceof Error ? error.message : "Unable to load Control Hosts");
    });
    return () => {
      current = false;
    };
  }, [homeBridgeUrl]);

  const savedHosts = status === "database" ? storedHosts : configuredHosts;
  const hosts = useMemo(
    () => hostOptions(activeHostUrl, savedHosts),
    [activeHostUrl, savedHosts],
  );

  return {
    hosts,
    storedHosts,
    status,
    message,
    async save(host) {
      const editing = "host_id" in host && typeof host.host_id === "string";
      const path = editing
        ? `/api/control-hosts/${encodeURIComponent(host.host_id!)}`
        : "/api/control-hosts";
      const response = await fetch(`${homeBridgeUrl}${path}`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: host.label, url: host.url }),
      });
      const body = await response.json().catch(() => undefined) as {
        host?: StoredControlHost;
        error?: string;
      } | undefined;
      if (!response.ok || !body?.host) {
        throw new Error(body?.error ?? `Unable to save Control Host (${response.status})`);
      }
      setStoredHosts((current) => editing
        ? current.map((candidate) => candidate.host_id === body.host!.host_id ? body.host! : candidate)
        : [...current, body.host!].sort(compareHosts));
      setStatus("database");
      setMessage(undefined);
    },
    async remove(hostId) {
      const response = await fetch(`${homeBridgeUrl}/api/control-hosts/${encodeURIComponent(hostId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
        throw new Error(body?.error ?? `Unable to remove Control Host (${response.status})`);
      }
      setStoredHosts((current) => current.filter((host) => host.host_id !== hostId));
    },
  };
}

async function requestHosts(homeBridgeUrl: string): Promise<StoredControlHost[]> {
  const response = await fetch(`${homeBridgeUrl}/api/control-hosts`);
  const body = await response.json().catch(() => undefined) as { hosts?: unknown; error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Unable to load Control Hosts (${response.status})`);
  if (!Array.isArray(body?.hosts) || !body.hosts.every(isStoredHost)) {
    throw new Error("The Home bridge returned invalid Control Host configuration");
  }
  return [...body.hosts].sort(compareHosts);
}

function isStoredHost(value: unknown): value is StoredControlHost {
  if (!value || typeof value !== "object") return false;
  const host = value as Partial<StoredControlHost>;
  return typeof host.host_id === "string"
    && typeof host.label === "string"
    && typeof host.url === "string"
    && typeof host.created_at === "string"
    && typeof host.updated_at === "string";
}

function compareHosts(first: ControlHost, second: ControlHost): number {
  return first.label.localeCompare(second.label, undefined, { sensitivity: "base" })
    || first.url.localeCompare(second.url);
}
