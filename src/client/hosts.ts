import hostConfig from "./hosts.json";

export interface ControlHost {
  label: string;
  url: string;
}

export function normalizeHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const configuredHosts: readonly ControlHost[] = hostConfig.map((host) => ({
  label: host.label,
  url: normalizeHost(host.url),
}));

export function resolveInitialHost(search: string, storedHost: string | null, origin: string): string {
  const queryHost = new URLSearchParams(search).get("host");
  return normalizeHost(queryHost ?? storedHost ?? origin);
}

/** Keeps development or shared-link hosts selectable without putting them in the saved host list. */
export function hostOptions(activeHost: string): readonly ControlHost[] {
  const activeUrl = normalizeHost(activeHost);
  if (configuredHosts.some((host) => host.url === activeUrl)) return configuredHosts;
  return [{ label: "Custom host", url: activeUrl }, ...configuredHosts];
}
