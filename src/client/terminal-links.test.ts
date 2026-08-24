import { describe, expect, it, vi } from "vitest";
import { createTerminalLinkInteractions, httpLink, openTerminalLink } from "./terminal-links";

describe("terminal links", () => {
  it("opens HTTP links in an isolated tab", () => {
    const opener = vi.fn(() => null);

    expect(openTerminalLink("https://example.com/docs?q=terminal", opener)).toBe(true);
    expect(opener).toHaveBeenCalledWith(
      "https://example.com/docs?q=terminal",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("rejects non-web and malformed links", () => {
    const opener = vi.fn(() => null);

    for (const value of ["javascript:alert(1)", "file:///etc/passwd", "https:example.com", "not a link"]) {
      expect(openTerminalLink(value, opener)).toBe(false);
    }
    expect(opener).not.toHaveBeenCalled();
    expect(httpLink("HTTP://example.com")).toBe("http://example.com/");
  });

  it("shows and removes the destination while hovering", () => {
    const element = documentElement();
    const links = createTerminalLinkInteractions(() => element);

    links.hover({} as MouseEvent, "https://example.com/path");
    expect(element.title).toBe("Open https://example.com/path");

    links.leave();
    expect(element.title).toBe("");
  });
});

function documentElement(): HTMLElement {
  return {
    title: "",
    removeAttribute(name: string) {
      if (name === "title") this.title = "";
    },
  } as HTMLElement;
}
