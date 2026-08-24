export type LinkOpener = (url: string, target: string, features: string) => Window | null;

export function httpLink(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function openTerminalLink(
  value: string,
  opener: LinkOpener = (url, target, features) => window.open(url, target, features),
): boolean {
  const url = httpLink(value);
  if (!url) return false;
  opener(url, "_blank", "noopener,noreferrer");
  return true;
}

/** Shares safe activation and a native URL tooltip between plain and OSC 8 links. */
export function createTerminalLinkInteractions(
  element: () => HTMLElement | undefined,
  opener?: LinkOpener,
) {
  let tooltip: string | undefined;

  return {
    activate(_event: MouseEvent, value: string): void {
      openTerminalLink(value, opener);
    },
    hover(_event: MouseEvent, value: string): void {
      const url = httpLink(value);
      const target = element();
      if (!url || !target) return;
      tooltip = `Open ${url}`;
      target.title = tooltip;
    },
    leave(): void {
      const target = element();
      if (target && target.title === tooltip) target.removeAttribute("title");
      tooltip = undefined;
    },
  };
}
