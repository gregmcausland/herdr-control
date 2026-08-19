import type { Terminal } from "@xterm/xterm";
import type { TerminalClientMessage } from "../shared/protocol";
import { takeScrollBatch, touchDeltaToLines, wheelDeltaToLines } from "./scroll";

interface TerminalInputChannel {
  active: () => boolean;
  send: (message: TerminalClientMessage) => void;
  status: (message: string) => void;
}

interface TerminalInputOptions {
  terminal: Terminal;
  host: HTMLElement;
  bridgeUrl: string;
  channel: TerminalInputChannel;
}

export interface TerminalInputController {
  sendKey: (data: string) => boolean;
  sendMessage: (text: string) => boolean;
  focus: () => void;
  dispose: () => void;
}

/** Owns browser input policy and forwards normalized terminal messages through one channel. */
export function attachTerminalInput({ terminal, host, bridgeUrl, channel }: TerminalInputOptions): TerminalInputController {
  const element = terminal.element;
  if (!element) throw new Error("Terminal input cannot attach before xterm is opened");

  let disposed = false;
  let pendingScrollLines = 0;
  let scrollColumn: number | undefined;
  let scrollRow: number | undefined;
  let scrollFrame: number | undefined;
  let touchPointer: number | undefined;
  let touchY: number | undefined;
  let touchTravel = 0;
  const messageTimers = new Set<number>();

  const sendScroll = (
    source: "wheel" | "page_key",
    direction: "up" | "down",
    lines: number,
    column?: number,
    row?: number,
  ) => {
    if (!channel.active()) return;
    // Herdr owns scroll position, while xterm owns browser selection anchored to cells.
    terminal.clearSelection();
    channel.send({ type: "scroll", source, direction, lines, column, row });
  };

  const dataSubscription = terminal.onData((data) => {
    if (channel.active()) channel.send({ type: "input", data });
  });
  const resizeSubscription = terminal.onResize(({ cols, rows }) => {
    if (channel.active()) channel.send({ type: "resize", cols, rows });
  });

  const pasteImage = async (image: Blob) => {
    if (!channel.active()) {
      channel.status("Take control before pasting an image");
      return;
    }

    channel.status("Uploading clipboard image…");
    const path = await stageClipboardImage(bridgeUrl, image);
    if (disposed) return;
    if (!channel.active()) {
      channel.status("Image uploaded, but terminal control was lost");
      return;
    }
    terminal.paste(path);
    channel.status("Control");
  };

  const handlePaste = (event: ClipboardEvent) => {
    const image = clipboardImageFromPaste(event.clipboardData);
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    void pasteImage(image).catch((error: unknown) => {
      if (!disposed) channel.status(error instanceof Error ? error.message : "Image paste failed");
    });
  };

  const handlePasteShortcut = (event: KeyboardEvent) => {
    const isPaste = event.key.toLowerCase() === "v" && (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!isPaste || typeof navigator.clipboard?.read !== "function") return;

    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!channel.active()) {
      channel.status("Take control before pasting");
      return;
    }

    void readBrowserClipboard().then(async (content) => {
      if (disposed) return;
      if (!content) {
        channel.status("Clipboard has no supported image or text");
      } else if (content.type === "image") {
        await pasteImage(content.data);
      } else if (channel.active()) {
        terminal.paste(content.data);
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        channel.status(error instanceof Error ? `Clipboard unavailable: ${error.message}` : "Clipboard unavailable");
      }
    });
  };

  terminal.attachCustomKeyEventHandler((event) => {
    if (!channel.active() || (event.key !== "PageUp" && event.key !== "PageDown")) return true;
    if (event.type === "keydown") {
      sendScroll("page_key", event.key === "PageUp" ? "up" : "down", terminal.rows);
    }
    return false;
  });

  const sendPendingScroll = (limit: number) => {
    const batch = takeScrollBatch(pendingScrollLines, limit);
    if (!batch) return;
    pendingScrollLines = batch.remainder;
    sendScroll("wheel", batch.direction, batch.lines, scrollColumn, scrollRow);
  };

  const flushScroll = () => {
    scrollFrame = undefined;
    sendPendingScroll(12);
    if (Math.abs(pendingScrollLines) >= 1) scrollFrame = requestAnimationFrame(flushScroll);
  };

  const handleWheel = (event: WheelEvent) => {
    if (!channel.active()) return;

    event.preventDefault();
    event.stopPropagation();
    pendingScrollLines += wheelDeltaToLines(event.deltaY, event.deltaMode, terminal.rows);

    [scrollColumn, scrollRow] = terminalCellAt(event.clientX, event.clientY, host, terminal);

    if (scrollFrame === undefined) scrollFrame = requestAnimationFrame(flushScroll);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !event.isPrimary || !channel.active()) return;
    touchPointer = event.pointerId;
    touchY = event.clientY;
    touchTravel = 0;
    host.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== touchPointer || touchY === undefined || !channel.active()) return;

    event.preventDefault();
    event.stopPropagation();
    const deltaY = touchY - event.clientY;
    touchTravel += Math.abs(deltaY);
    touchY = event.clientY;
    const bounds = host.getBoundingClientRect();
    pendingScrollLines += touchDeltaToLines(deltaY, bounds.height, terminal.rows);
    [scrollColumn, scrollRow] = terminalCellAt(event.clientX, event.clientY, host, terminal);
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    sendPendingScroll(1_000);
  };

  const finishPointer = (event: PointerEvent, focusOnTap: boolean) => {
    if (event.pointerId !== touchPointer) return;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    if (focusOnTap && touchTravel < 8) terminal.focus();
    touchPointer = undefined;
    touchY = undefined;
    touchTravel = 0;
  };

  const handlePointerUp = (event: PointerEvent) => finishPointer(event, true);
  const handlePointerCancel = (event: PointerEvent) => finishPointer(event, false);

  const suppressXtermTouch = (event: TouchEvent) => {
    // xterm's touch target may be replaced by a remote redraw mid-gesture. The
    // stable host's captured pointer stream owns touch scrolling instead.
    event.stopPropagation();
    if (event.type === "touchmove") event.preventDefault();
  };

  const resetTouch = () => {
    if (touchPointer !== undefined && host.hasPointerCapture(touchPointer)) {
      host.releasePointerCapture(touchPointer);
    }
    touchPointer = undefined;
    touchY = undefined;
    touchTravel = 0;
  };

  element.addEventListener("paste", handlePaste, { capture: true });
  element.addEventListener("keydown", handlePasteShortcut, { capture: true });
  host.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  host.addEventListener("pointerdown", handlePointerDown, { capture: true });
  host.addEventListener("pointermove", handlePointerMove, { capture: true });
  host.addEventListener("pointerup", handlePointerUp, { capture: true });
  host.addEventListener("pointercancel", handlePointerCancel, { capture: true });
  host.addEventListener("touchstart", suppressXtermTouch, { capture: true, passive: true });
  host.addEventListener("touchmove", suppressXtermTouch, { capture: true, passive: false });

  const sendKey = (data: string) => {
    if (!channel.active()) return false;
    terminal.input(data, true);
    return true;
  };

  const sendMessage = (text: string) => {
    if (!channel.active() || text.trim().length === 0) return false;
    terminal.paste(text);
    const timer = window.setTimeout(() => {
      messageTimers.delete(timer);
      if (!disposed && channel.active()) terminal.input("\r", true);
    }, 75);
    messageTimers.add(timer);
    return true;
  };

  const dispose = () => {
    disposed = true;
    element.removeEventListener("paste", handlePaste, { capture: true });
    element.removeEventListener("keydown", handlePasteShortcut, { capture: true });
    host.removeEventListener("wheel", handleWheel, { capture: true });
    host.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    host.removeEventListener("pointermove", handlePointerMove, { capture: true });
    host.removeEventListener("pointerup", handlePointerUp, { capture: true });
    host.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
    host.removeEventListener("touchstart", suppressXtermTouch, { capture: true });
    host.removeEventListener("touchmove", suppressXtermTouch, { capture: true });
    resetTouch();
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    for (const timer of messageTimers) window.clearTimeout(timer);
    messageTimers.clear();
    dataSubscription.dispose();
    resizeSubscription.dispose();
  };

  return {
    sendKey,
    sendMessage,
    focus: () => terminal.focus(),
    dispose,
  };
}

function terminalCellAt(clientX: number, clientY: number, host: HTMLElement, terminal: Terminal): [number, number] {
  const bounds = host.getBoundingClientRect();
  const column = Math.max(0, Math.min(terminal.cols - 1, Math.floor(((clientX - bounds.left) / bounds.width) * terminal.cols)));
  const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor(((clientY - bounds.top) / bounds.height) * terminal.rows)));
  return [column, row];
}

function clipboardImageFromPaste(clipboard: DataTransfer | null): File | undefined {
  if (!clipboard) return undefined;

  for (const item of Array.from(clipboard.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }

  return Array.from(clipboard.files).find((file) => file.type.startsWith("image/"));
}

type BrowserClipboardContent =
  | { type: "image"; data: Blob }
  | { type: "text"; data: string };

async function readBrowserClipboard(): Promise<BrowserClipboardContent | undefined> {
  const items = await navigator.clipboard.read();

  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (imageType) return { type: "image", data: await item.getType(imageType) };
  }

  for (const item of items) {
    if (item.types.includes("text/plain")) {
      return { type: "text", data: await (await item.getType("text/plain")).text() };
    }
  }

  return undefined;
}

async function stageClipboardImage(bridgeUrl: string, image: Blob): Promise<string> {
  const response = await fetch(new URL("/api/clipboard-image", bridgeUrl), {
    method: "POST",
    headers: { "Content-Type": image.type },
    body: image,
  });
  const body = await response.json() as { path?: string; error?: string };
  if (!response.ok || !body.path) throw new Error(body.error ?? "Image upload failed");
  return body.path;
}
