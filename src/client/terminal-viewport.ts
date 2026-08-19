/** Keeps the terminal fitted to what is visible above mobile browser chrome and keyboards. */
export function attachTerminalViewport(screen: HTMLElement): () => void {
  const viewport = window.visualViewport;
  let frame: number | undefined;

  const update = () => {
    frame = undefined;
    const height = viewport?.height ?? window.innerHeight;
    const width = viewport?.width ?? window.innerWidth;
    screen.style.setProperty("--terminal-viewport-height", `${height}px`);
    screen.style.setProperty("--terminal-viewport-width", `${width}px`);
    screen.style.setProperty("--terminal-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    screen.style.setProperty("--terminal-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
  };

  const scheduleUpdate = () => {
    if (frame === undefined) frame = requestAnimationFrame(update);
  };

  update();
  window.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);

  return () => {
    window.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
