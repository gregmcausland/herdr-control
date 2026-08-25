export interface ControlHost {
  host_id?: string;
  label: string;
  url: string;
}

export interface StoredControlHost extends ControlHost {
  host_id: string;
  created_at: string;
  updated_at: string;
}

/** Returns an HTTP origin suitable for addressing one Control bridge. */
export function normalizeControlHostUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Control Host URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Control Host URL must be an HTTP or HTTPS origin");
  }
  return parsed.origin;
}
