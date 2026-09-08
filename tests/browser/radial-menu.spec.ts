import { expect, test, type Locator, type Page } from "@playwright/test";

const client = process.env.HERDR_CONTROL_TEST_CLIENT;

async function fixture(page: Page, count = 1000, agents = ["codex", "claude", "gemini", "pi", "opencode"]) {
  const projects = Array.from({ length: count }, (_, index) => ({
    project_id: `project-${index}`, name: `Project ${String(index + 1).padStart(4, "0")}`,
    repo_key: `/repo-${index}/.git`, repo_root: `/repo-${index}`,
    created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  }));
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      set onerror(_listener: unknown) {}
      get onerror() { return null; }
    } as typeof EventSource;
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/control-hosts") return route.fulfill({ json: { hosts: [] } });
    if (path === "/api/agents") return route.fulfill({ json: { agents } });
    if (path === "/api/session/events") return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({
      status: "live", revision: 1, snapshot: { version: "test", protocol: 20, workspaces: [], tabs: [], panes: [], threads: [], projects, worktrees: [] },
    })}\n\n` });
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture request" } });
  });
  await page.goto(client!);
}

async function openProjects(page: Page) {
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Home", exact: true }).getByRole("button", { name: "New thread", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a project", exact: true });
  await picker.waitFor({ state: "visible" });
  return picker;
}

async function expectOutlineOrbs(picker: Locator) {
  await expect(picker.locator(".radial-well")).toHaveCount(0);
  const orb = picker.locator(".radial-option").first();
  await expect(orb).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(orb).toHaveCSS("background-image", "none");
  await expect(orb).toHaveCSS("box-shadow", "none");
  await expect(orb).toHaveCSS("border-top-width", "1px");
  await orb.hover();
  await expect(orb).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(orb).toHaveCSS("background-image", "none");
}

/** Keep native touch timestamps realistic without sleeps or synthetic pointer capture. */
async function touchArc(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator(".radial-wheel").boundingBox())!;
  let timestamp = Date.now() / 1000;
  const point = (angle: number) => ({
    x: box.x + (328 - 200 * Math.cos(angle * Math.PI / 180)) * box.width / 360,
    y: box.y + (328 - 200 * Math.sin(angle * Math.PI / 180)) * box.height / 360,
    id: 1,
  });
  return {
    start: (angle: number) => {
      timestamp = Math.max(Date.now() / 1000, timestamp + .5);
      return cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp, touchPoints: [point(angle)] });
    },
    move: (angle: number) => {
      timestamp += .05;
      return cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp, touchPoints: [point(angle)] });
    },
    end: (cancel = false) => {
      timestamp += .05;
      return cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", timestamp, touchPoints: [] });
    },
  };
}

test.beforeEach(() => test.skip(!client, "Mock browser client required"));

test("keeps the resting launcher thumb-sized and inset, then shrinks it into the menu hub", async ({ page }, info) => {
  await fixture(page, 4);
  const launcher = page.getByRole("button", { name: "Open menu", exact: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(launcher).toHaveCSS("width", "72px");
    await expect(launcher).toHaveCSS("height", "72px");
    expect(await launcher.boundingBox()).toEqual({ x: width - 104, y: 740, width: 72, height: 72 });
    if (width === 390) await page.screenshot({ path: info.outputPath("launcher-resting-phone.png") });
    await launcher.click();
    const home = page.getByRole("dialog", { name: "Home", exact: true });
    const hub = home.getByRole("button", { name: "Close menu", exact: true });
    await expect(hub).toHaveCSS("animation-name", "radial-hub-enter");
    await expect.poll(async () => (await hub.boundingBox())?.width).toBe(60);
    expect(await hub.boundingBox()).toEqual({ x: width - 72, y: 772, width: 60, height: 60 });
    await expect(page.locator(".home-menu-trigger")).toHaveCSS("opacity", "0");
    if (width === 390) await page.screenshot({ path: info.outputPath("launcher-open-phone.png") });
    await page.keyboard.press("Escape");
    await expect(launcher).toBeFocused();
  }

  await openProjects(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const hub = page.getByRole("dialog", { name: "Home", exact: true }).locator(".radial-hub");
  await expect(hub).toHaveCSS("animation-name", "none");
  await expect(hub).toHaveCSS("width", "60px");
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await launcher.click();
  await expect(hub).toHaveCSS("animation-name", "none");
  await expect(hub).toHaveCSS("width", "60px");
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveCSS("transition-duration", "0s");
  await expect(launcher).toHaveCSS("width", "72px");
});

test("stages entry, completes one exit action, and never replays entry while scrolling", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).radialTransitions = [];
    document.addEventListener("animationstart", event => {
      const target = event.target as HTMLElement;
      const dialog = target.closest<HTMLDialogElement>(".radial-dialog");
      if (!dialog) return;
      const style = getComputedStyle(target);
      (window as any).radialTransitions.push({
        name: event.animationName, duration: style.animationDuration, delay: style.animationDelay,
        open: dialog.open, inert: dialog.querySelector<HTMLElement>(".radial-panel")?.inert,
      });
    }, true);
  });
  const transitions = () => page.evaluate(() => (window as any).radialTransitions as Array<{
    name: string; duration: string; delay: string; open: boolean; inert: boolean;
  }>);
  const launcher = page.getByRole("button", { name: "Open menu", exact: true });
  await launcher.click();
  const home = page.getByRole("dialog", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("data-presence", "open");
  const entry = await transitions();
  expect(entry.find(event => event.name === "radial-menu-enter")?.duration).toBe("0.22s");
  expect(entry.filter(event => event.name === "radial-orb-enter").slice(0, 3).map(event => event.delay)).toEqual(["0s", "0.018s", "0.036s"]);

  // A second action during exit must not open a second screen behind the next tier.
  await home.evaluate(element => {
    element.querySelector<HTMLButtonElement>('[data-index="0"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-index="1"]')!.click();
  });
  const picker = page.getByRole("dialog", { name: "Choose a project", exact: true });
  await expect(picker).toHaveAttribute("data-presence", "open");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const exit = (await transitions()).find(event => event.name === "radial-menu-exit");
  expect(exit).toMatchObject({ duration: "0.12s", open: true, inert: true });
  const beforeScroll = (await transitions()).length;
  await picker.getByRole("group", { name: "Radial options" }).press("End");
  await expect(picker.getByRole("button", { name: /Project 1000/ })).toBeFocused();
  expect((await transitions()).length).toBe(beforeScroll);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await transitions()).some(event => event.name === "radial-backdrop-exit")).toBe(true);
  await expect(launcher).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { (window as any).radialTransitions = []; });
  await launcher.click();
  await expect(home).toHaveAttribute("data-presence", "open");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await transitions()).toEqual([]);

  // A missing animationend must not leave an inert modal trapping the user.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addStyleTag({ content: '.radial-dialog[data-presence="leaving"] .radial-panel { animation: none !important; }' });
  await launcher.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test("navigates tiers, remembers the project position, and reaches a long list's ends without wrapping", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const picker = await openProjects(page);
  const wheel = picker.getByRole("group", { name: "Radial options" });
  const meter = picker.getByRole("meter", { name: "List position" });
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(picker.getByRole("button", { name: "Previous options" })).toBeDisabled();
  await expectOutlineOrbs(picker);
  await page.screenshot({ path: info.outputPath("projects-start-phone.png") });
  await wheel.press("End");
  await expect(picker.getByRole("button", { name: /Project 1000/ })).toBeFocused();
  await expect(meter).toHaveAttribute("aria-valuenow", "997");
  expect(await picker.locator(".radial-option").count()).toBeLessThanOrEqual(6);
  await expect(picker.getByRole("button", { name: /Project 0001/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "Next options" })).toBeDisabled();
  await wheel.hover();
  await page.mouse.wheel(0, 10000);
  await expect(meter).toHaveAttribute("aria-valuenow", "997");
  await page.mouse.wheel(0, -150);
  await expect(meter).toHaveAttribute("aria-valuenow", "995.5");
  await page.mouse.wheel(0, -1000000);
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await page.mouse.wheel(0, 1000000);
  await expect(meter).toHaveAttribute("aria-valuenow", "997");
  await page.screenshot({ path: info.outputPath("projects-end-phone.png") });
  await picker.getByRole("button", { name: /Project 1000/ }).click();
  const agents = page.getByRole("dialog", { name: "Choose an agent for Project 1000" });
  await agents.getByRole("button", { name: "Back", exact: true }).click();
  await expect(meter).toHaveAttribute("aria-valuenow", "997");
  await picker.getByRole("button", { name: /Project 1000/ }).click();
  await agents.getByRole("group", { name: "Radial options" }).press("End");
  await agents.getByRole("button", { name: "OpenCode", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New thread", exact: true });
  await expect(form).toContainText("Project 1000");
  await expect(form.getByRole("button", { name: /Agent settings/ })).toContainText("OpenCode");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
});

test("upright orbs follow touch, coast gently on release, and stay inside narrow screens", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "Native touch movement uses Chromium's input protocol");
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await fixture(page, 30);
    const picker = await openProjects(page);
    const wheel = picker.locator(".radial-wheel");
    const touch = await touchArc(page);
    const pageScroll = await page.evaluate(() => window.scrollY);
    // Starts on the third orb, exercising touch's implicit button capture.
    await touch.start(75);
    for (const angle of [65, 55, 45, 35, 25, 15]) await touch.move(angle);
    await expect(picker.getByRole("meter")).toHaveAttribute("aria-valuenow", "2");
    const orb = picker.locator('.radial-option[data-index="3"]');
    const geometry = await orb.evaluate(element => {
      const style = getComputedStyle(element);
      const matrix = new DOMMatrix(style.transform);
      return { width: element.clientWidth, height: element.clientHeight, radius: style.borderRadius, rotation: [matrix.a, matrix.b, matrix.c, matrix.d] };
    });
    expect(geometry.width).toBe(geometry.height);
    expect(geometry.radius).toBe("50%");
    expect(geometry.rotation).toEqual([1, 0, 0, 1]);
    await touch.end();
    await expect(picker).toBeVisible();
    await expect(wheel).toHaveAttribute("data-motion", "settling");
    await expect.poll(async () => Number(await picker.getByRole("meter").getAttribute("aria-valuenow"))).toBeGreaterThan(2.2);
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await expect(picker.getByRole("meter")).toHaveAttribute("aria-valuenow", "3");
    await expect(picker.getByRole("button", { name: /Project 0001/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
    for (const option of await picker.getByRole("button").all()) {
      await expect(option).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("rotated-320.png") });
    await touch.start(15);
    await touch.end();
    const agents = page.getByRole("dialog", { name: "Choose an agent for Project 0004" });
    await expect(agents).toBeVisible();
    await agents.getByRole("button", { name: "Back", exact: true }).click();
    await expect(picker.getByRole("meter")).toHaveAttribute("aria-valuenow", "3");
  } finally { await context.close(); }
});

test("springs back at the ends, lets a finger catch momentum, and respects reduced motion", async ({ browser, browserName }, info) => {
  test.skip(browserName !== "chromium", "Native touch movement uses Chromium's input protocol");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await fixture(page, 30);
    const picker = await openProjects(page);
    const wheel = picker.locator(".radial-wheel");
    const meter = picker.getByRole("meter");
    const touch = await touchArc(page);
    const first = picker.locator('.radial-option[data-index="0"]');
    const originalTop = await first.evaluate(element => parseFloat(element.style.top));
    await touch.start(45);
    for (const angle of [55, 65, 75, 85]) await touch.move(angle);
    expect(await first.evaluate(element => parseFloat(element.style.top))).toBeLessThan(originalTop - 5);
    await expect(meter).toHaveAttribute("aria-valuenow", "0");
    await page.screenshot({ path: info.outputPath("elastic-start.png") });
    await touch.end();
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    expect(await first.evaluate(element => parseFloat(element.style.top))).toBeCloseTo(originalTop);

    await wheel.press("End");
    await touch.start(75);
    for (const angle of [65, 55, 45, 35, 25, 15]) await touch.move(angle);
    await expect(meter).toHaveAttribute("aria-valuenow", "27");
    await expect(picker.getByRole("button", { name: /Project 0001/ })).toHaveCount(0);
    await touch.end();
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await expect(meter).toHaveAttribute("aria-valuenow", "27");

    await wheel.press("Home");
    await touch.start(75);
    for (const angle of [65, 55, 45, 35, 25, 15]) await touch.move(angle);
    await touch.end();
    await expect(wheel).toHaveAttribute("data-motion", "settling");
    await touch.start(45);
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    const caught = await meter.getAttribute("aria-valuenow");
    // Several frames with the finger held down must not resume the glide.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    await expect(meter).toHaveAttribute("aria-valuenow", caught!);
    await touch.end();
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await expect(picker).toBeVisible();

    await wheel.press("Home");
    await touch.start(75);
    for (const angle of [65, 55, 45, 35, 25, 15]) await touch.move(angle);
    await touch.end(true);
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await expect(meter).toHaveAttribute("aria-valuenow", "2");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await wheel.press("Home");
    await touch.start(45);
    await touch.move(75);
    expect(await first.evaluate(element => parseFloat(element.style.top))).toBeCloseTo(originalTop);
    await touch.end(true);
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await touch.start(75);
    for (const angle of [65, 55, 45, 35, 25, 15]) await touch.move(angle);
    await touch.end();
    await expect(wheel).toHaveAttribute("data-motion", "idle");
    await expect(meter).toHaveAttribute("aria-valuenow", "2");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("handles empty inventories and offers home actions through the same menu", async ({ page }, info) => {
  await fixture(page, 1, []);
  const picker = await openProjects(page);
  await picker.getByRole("button", { name: /Project 0001/ }).click();
  await expect(page.getByText("No supported agents found on this host")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const home = page.getByRole("dialog", { name: "Home", exact: true });
  await home.getByRole("group", { name: "Radial options" }).press("End");
  await home.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Theme", exact: true }).selectOption("catppuccinLatte");
  await settings.getByRole("button", { name: "Save changes", exact: true }).click();
  const lightPicker = await openProjects(page);
  await expectOutlineOrbs(lightPicker);
  await page.screenshot({ path: info.outputPath("projects-light-desktop.png") });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(lightPicker.getByRole("heading")).toBeInViewport();
  for (const button of await lightPicker.getByRole("button").all()) await expect(button).toBeInViewport();
  await page.screenshot({ path: info.outputPath("projects-light-landscape.png") });
  await page.mouse.click(10, 10);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await fixture(page, 0);
  await openProjects(page);
  await expect(page.getByText("No projects yet. Open a repository in Herdr to get started.")).toBeVisible();
});
