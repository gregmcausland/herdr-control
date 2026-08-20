const PANE_ROUTE = /^\/panes\/([^/]+)\/?$/;
const THREAD_ROUTE = /^\/threads\/([^/]+)\/?$/;
const ROUTE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;

export interface TerminalRoute {
  kind: "thread" | "pane";
  id: string;
}

export function terminalRouteFromPath(pathname: string): TerminalRoute | undefined {
  const threadId = decodeRouteId(THREAD_ROUTE.exec(pathname)?.[1]);
  if (threadId) return { kind: "thread", id: threadId };
  const paneId = decodeRouteId(PANE_ROUTE.exec(pathname)?.[1]);
  return paneId ? { kind: "pane", id: paneId } : undefined;
}

function decodeRouteId(encodedId: string | undefined): string | undefined {
  if (!encodedId) return undefined;
  try {
    const id = decodeURIComponent(encodedId);
    return ROUTE_ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function panePath(paneId: string, search = ""): string {
  return `/panes/${encodeURIComponent(paneId)}${search}`;
}

export function threadPath(threadId: string, search = ""): string {
  return `/threads/${encodeURIComponent(threadId)}${search}`;
}

export function homePath(search = ""): string {
  return `/${search}`;
}
