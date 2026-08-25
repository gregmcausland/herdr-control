import hostConfig from "./hosts.json";
import {
  normalizeControlHostUrl,
  type ControlHost,
} from "../shared/control-hosts";

export type { ControlHost, StoredControlHost } from "../shared/control-hosts";

export function normalizeHost(value: string): string {
  return normalizeControlHostUrl(value);
}

/** One-release fallback while the Home bridge imports build-time configuration. */
export const configuredHosts: readonly ControlHost[] = hostConfig.map((host) => ({
  label: host.label,
  url: normalizeHost(host.url),
}));

export function resolveInitialHost(search: string, storedHost: string | null, origin: string): string {
  const queryHost = new URLSearchParams(search).get("host");
  return normalizeHost(queryHost ?? storedHost ?? origin);
}

/** Keeps development or shared-link hosts selectable without putting them in the saved host list. */
export function hostOptions(
  activeHost: string,
  savedHosts: readonly ControlHost[] = configuredHosts,
): readonly ControlHost[] {
  const activeUrl = normalizeHost(activeHost);
  if (savedHosts.some((host) => host.url === activeUrl)) return savedHosts;
  return [{ label: "Custom host", url: activeUrl }, ...savedHosts];
}
