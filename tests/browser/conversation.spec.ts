import { expect, test, type Page } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const client = process.env.HERDR_CONTROL_TEST_CLIENT;
const thread = {
  thread_id: "thread-1", title: "Fix mobile reconnects", agent: "codex", lifecycle: "open",
  agent_session: { source: "herdr:codex", agent: "codex", kind: "id", value: "session-1" },
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  current_run: { run_id: "run-1", terminal_id: "terminal-1", pane_id: "w1:p1", workspace_id: "w1", workspace_label: "Control", tab_id: "w1:t1", started_at: new Date().toISOString(), agent_status: "idle" },
};
const snapshot = {
  version: "test", protocol: 19, threads: [thread],
  workspaces: [{ workspace_id: "w1", label: "Control", number: 1, tab_count: 1, pane_count: 1, focused: false }], tabs: [],
  panes: [{ ...thread.current_run, thread_id: thread.thread_id, agent: "codex", label: thread.title, focused: false }],
};

async function fixture(page: Page) {
  // Route fixtures return finite SSE bodies; keep the simulated feed open.
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    (window as any).testFeeds = [];
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL) { super(url); (window as any).testFeeds.push(this); }
      set onerror(_listener: unknown) {}
      get onerror() { return null; }
    } as typeof EventSource;
  });
  const currentThread = structuredClone(thread);
  const currentSnapshot = { ...snapshot, threads: [currentThread] };
  const messages: any[] = [{ message_id: "reply-1", sequence: 1, thread_id: thread.thread_id, role: "assistant", source: "agent", created_at: new Date().toISOString(), text: "## Ready to review\n\nThe reconnect fix is ready.\n\n- Drafts survive navigation.\n- [Read the docs](https://example.com).\n\n<script>window.injected = true</script>" }];
  const submissions: any[] = [];
  const sockets: string[] = [];
  let offline = false;
  let loseAcknowledgement = false;
  await page.route("**/api/control-hosts", (route) => route.fulfill({ json: { hosts: [] } }));
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: ["codex"] } }));
  await page.route("**/api/session/events", (route) => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ status: offline ? "stale" : "live", revision: 1, snapshot: currentSnapshot })}\n\n` }));
  await page.route("**/api/threads/thread-1/conversation*", (route) => offline ? route.abort() : route.fulfill({ json: { thread: currentThread, messages, capture_available: true, has_older: false } }));
  await page.route("**/api/threads/thread-1/messages", async (route) => {
    const input = route.request().postDataJSON();
    submissions.push(input);
    let message = messages.find((message) => message.message_id === input.message_id);
    if (!message) {
      message = { message_id: input.message_id, sequence: messages.length + 1, thread_id: thread.thread_id, text: input.text, role: "user", source: "control", delivery: "acknowledged", created_at: new Date().toISOString() };
      messages.push(message);
    }
    if (loseAcknowledgement) { loseAcknowledgement = false; await route.abort(); }
    else await route.fulfill({ json: { acknowledged: true, message } });
  });
  await page.routeWebSocket(/\/api\/terminal/, (socket) => {
    sockets.push(socket.url());
    socket.onMessage((message) => {
      const { type } = JSON.parse(String(message));
      if (type === "release") socket.send(JSON.stringify({ type: "released" }));
      if (type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    });
    socket.send(JSON.stringify({ type: "ready", mode: "control" }));
  });
  return { messages, submissions, sockets, offline: (value: boolean) => { offline = value; }, loseAcknowledgement: () => { loseAcknowledgement = true; },
    status: async (status: string, feedStatus = "live") => {
      currentThread.current_run.agent_status = status;
      Object.assign(currentThread.current_run, { working_started_at: new Date(Date.now() - 125_000).toISOString() });
      await page.evaluate(data => {
        for (const source of (window as any).testFeeds) source.dispatchEvent(new MessageEvent("message", { data }));
      }, JSON.stringify({ status: feedStatus, revision: 2, snapshot: currentSnapshot }));
    },
  };
}

async function open(page: Page) {
  await page.goto(`${client}/threads/thread-1?host=${encodeURIComponent(client!)}`);
  await expect(page.getByRole("heading", { name: "Ready to review" })).toBeVisible();
}

test("keeps a connected host usable when its old bridge returns HTML for conversations", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await page.route("**/api/threads/thread-1/conversation*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html>Old bridge</html>" }));
  await page.goto(`${client}/threads/thread-1?host=${encodeURIComponent(client!)}`);
  await expect(page.locator(".conversation-header small")).toContainText("Live · idle · History unavailable");
  await expect(page.locator(".conversation-reader")).toContainText("Update and restart its Control bridge");
  await expect(page.getByRole("button", { name: "Open terminal", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Keep this draft");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  expect(state.submissions).toHaveLength(0);
  expect(state.sockets).toHaveLength(0);
  await page.unroute("**/api/threads/thread-1/conversation*");
  await page.route("**/api/threads/thread-1/conversation*", route => route.fulfill({ json: { thread, messages: state.messages, capture_available: true, has_older: false } }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "Ready to review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Keep this draft");
});

test("reads replies and preserves drafts across navigation, reload and terminal drill-down", async ({ browser }) => {
  test.skip(!client, "Browser client required");
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const state = await fixture(page);
  await open(page);
  expect(state.sockets).toHaveLength(0);
  await expect(page.locator(".message-markdown script")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Please explain the change\non my phone");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Open Fix mobile reconnects on Custom host" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  expect(state.sockets).toHaveLength(0);
  await page.getByRole("button", { name: "Open terminal" }).click();
  await expect(page.locator(".terminal-header small")).toHaveText("Control");
  expect(state.sockets).toHaveLength(1);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Please explain the change\non my phone");
  await page.setViewportSize({ width: 390, height: 430 });
  await expect.poll(async () => {
    const send = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
    return send!.y + send!.height;
  }).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/herdr-control-conversation-mobile.png" });
  await context.close();
});

test("recovers a lost send acknowledgement through its durable receipt", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await open(page);
  state.loseAcknowledgement();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Continue with the fix");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
  await expect(page.locator(".conversation-message.user")).toHaveCount(1);
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0].message_id).toBeTruthy();
  expect(state.sockets).toHaveLength(0);
});

test("keeps cached replies and drafts readable while the host is unavailable", async ({ page }) => {
  test.skip(!client, "Browser client required");
  const state = await fixture(page);
  await open(page);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("A draft while offline");
  state.offline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ready to review" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("A draft while offline");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  state.offline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  expect(state.sockets).toHaveLength(0);
});

test("animates live work beside the composer and settles when work finishes or disconnects", async ({ page }, testInfo) => {
  test.skip(!client, "Browser client required");
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  state.messages.unshift({ message_id: "prompt", sequence: 0, thread_id: thread.thread_id, role: "user", source: "control", delivery: "acknowledged", created_at: new Date().toISOString(), text: "Make reconnecting feel seamless on my phone. Keep the draft and bring me back to where I was reading." });
  state.messages[1].text = "## Ready to review\n\nThe reconnect fix is ready. Your draft stays with you when you switch apps or reload.\n\n- Return to the same reading position.\n- Reconnect without taking over the terminal.\n\nI’m checking the keyboard behaviour next.";
  await open(page);
  await state.status("working");
  const working = page.locator(".conversation-working");
  const canvas = working.locator("canvas");
  await expect(working.getByRole("status")).toHaveText("Codex is working");
  await expect(working.getByLabel("Time working")).toContainText("2m");
  const frame = () => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  const first = await frame();
  await expect.poll(frame).not.toBe(first);
  await page.screenshot({ path: testInfo.outputPath("chat-working-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("chat-working-desktop.png") });
  await page.evaluate(() => localStorage.setItem("herdr-control-settings", JSON.stringify({ theme: "catppuccinLatte" })));
  await page.reload();
  await expect(working).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chat-working-light.png") });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await working.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Thread actions" }).click();
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Thread actions" }).click();
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(working.locator(".conversation-working-beacon")).toHaveCSS("animation-name", "none");
  // Let the single reduced-motion frame paint before comparing frames.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const still = await frame();
  await page.waitForTimeout(150);
  expect(await frame()).toBe(still);
  state.messages.push({ ...state.messages[1], message_id: "long-reply", sequence: 2, text: "A longer explanation.\n\n".repeat(30) });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".conversation-message")).toHaveCount(3);
  await page.locator(".conversation-reader").evaluate(el => { el.scrollTop = 0; });
  await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  await expect(working).toBeInViewport();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Keep this draft while you work");
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(working).toBeInViewport();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  expect(await page.locator(".conversation-reader").evaluate(el => el.clientHeight)).toBeGreaterThan(80);
  expect(await page.locator(".conversation-reader").evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await expect.poll(() => page.locator(".conversation-reader").evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("chat-working-keyboard.png") });
  await state.status("working", "stale");
  await expect(working).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await state.status("done");
  await expect(working).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Keep this draft while you work");
  expect(state.submissions).toHaveLength(0);
  expect(state.sockets).toHaveLength(0);
});

test.describe("voice input", () => {

  async function voiceFixture(page: Page) {
    const state = await fixture(page);
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await getUserMedia(constraints);
        (window as any).voiceStream = stream;
        return stream;
      };
    });
    return state;
  }

  test("records into an editable draft without sending and fits phone and desktop", async ({ page }, testInfo) => {
    test.skip(!client, "Browser client required");
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await voiceFixture(page);
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    await page.route("**/api/transcription", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
      expect(route.request().headers()["content-type"]).toContain("audio/webm");
      expect(route.request().postDataBuffer()!.length).toBeGreaterThan(0);
      await gate;
      await route.fulfill({ json: { text: "Review the Herdr changes." } });
    });
    await open(page);
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(page.getByRole("button", { name: "Dictate message" })).toContainText("Speak a message");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeHidden();
    expect((await page.getByRole("button", { name: "Dictate message" }).boundingBox())!.width).toBeGreaterThan(240);
    await page.screenshot({ path: testInfo.outputPath("dictation-ready-phone.png") });
    await page.getByRole("button", { name: "Type a message", exact: true }).click();
    await expect(draft).toBeFocused();
    await draft.fill("Please");
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("status")).toContainText("Recording");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await expect(page.locator(".voice-duration")).toHaveAttribute("aria-label", "1s / 120s");
    await expect(page.getByRole("img", { name: "Live microphone waveform" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("dictation-recording-phone.png") });
    const upload = page.waitForRequest(request => request.url().endsWith("/api/transcription") && request.method() === "POST");
    await page.getByRole("button", { name: "Stop recording" }).click();
    await upload;
    await expect(page.getByRole("status")).toHaveText("Transcribing…");
    await expect(page.getByRole("img", { name: "Live microphone waveform" })).toHaveCount(0);
    await draft.fill("Please also");
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 320, height: 430 }]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
      expect(await page.locator(".conversation-composer").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.locator(".conversation-input").evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return [...el.querySelectorAll("button")].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`dictation-transcribing-${viewport.width}.png`) });
    }
    finish();
    await expect(draft).toHaveValue("Please also Review the Herdr changes.");
    await page.screenshot({ path: testInfo.outputPath("dictation-draft-keyboard.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("dictation-draft-phone.png") });
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    expect(state.submissions).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).voiceStream.getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
    await page.reload();
    await expect(draft).toHaveValue("Please also Review the Herdr changes.");
    await page.evaluate(() => localStorage.setItem("herdr-control-settings", JSON.stringify({ theme: "catppuccinLatte" })));
    await page.reload();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("dictation-draft-light.png") });
    await draft.fill("");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("dictation-ready-light.png") });
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("img", { name: "Live microphone waveform" })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("dictation-recording-light.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("waveform responds to microphone audio and silence, then releases its audio context", async ({ page }, testInfo) => {
    test.skip(!client, "Browser client required");
    await fixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/transcription", route => route.fulfill({ json: { available: true } }));
    await page.addInitScript(() => {
      const NativeAudioContext = window.AudioContext;
      (window as any).waveformContexts = [];
      window.AudioContext = class extends NativeAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          (window as any).waveformContexts.push(this);
        }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new NativeAudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const output = context.createMediaStreamDestination();
        gain.gain.value = 0;
        oscillator.connect(gain); gain.connect(output); oscillator.start();
        await context.resume();
        (window as any).voiceGain = gain;
        (window as any).voiceStream = output.stream;
        return output.stream;
      };
    });
    await open(page);
    await page.getByRole("button", { name: "Dictate message" }).click();
    const waveform = page.getByRole("img", { name: "Live microphone waveform" });
    await expect(waveform).toBeVisible();
    await expect.poll(() => waveform.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(300);
    const snapshot = () => waveform.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const silence = await snapshot();
    await page.evaluate(() => { (window as any).voiceGain.gain.value = 0.15; });
    await expect.poll(snapshot).not.toBe(silence);
    await expect(page.locator(".voice-duration")).toHaveAttribute("aria-label", "2s / 120s");
    await page.screenshot({ path: testInfo.outputPath("waveform-speaking-phone.png") });
    await page.setViewportSize({ width: 320, height: 430 });
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeInViewport();
    await expect(waveform).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("waveform-keyboard-phone.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { (window as any).voiceGain.gain.value = 0; });
    await expect.poll(snapshot, { timeout: 6000 }).toBe(silence);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(waveform).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).voiceStream.getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).waveformContexts.every((context: AudioContext) => context.state === "closed"))).toBe(true);
  });

  test("cancel releases the microphone without uploading, and navigation drops a pending transcript", async ({ page }) => {
    test.skip(!client, "Browser client required");
    const state = await voiceFixture(page);
    let uploads = 0;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    await page.route("**/api/transcription", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
      uploads++;
      await gate;
      await route.fulfill({ json: { text: "Late transcript" } }).catch(() => undefined);
    });
    await open(page);
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await draft.fill("Keep my draft");
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Dictate message" })).toBeEnabled();
    expect(uploads).toBe(0);
    expect(await page.evaluate(() => (window as any).voiceStream.getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.locator(".voice-duration")).toHaveAttribute("aria-label", "1s / 120s");
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect.poll(() => uploads).toBe(1);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    finish();
    await page.getByRole("button", { name: "Open Fix mobile reconnects on Custom host" }).click();
    await expect(draft).toHaveValue("Keep my draft");
    expect(state.submissions).toHaveLength(0);
  });

  test("recording holds a screen wake lock and releases it on finish, cancel and pagehide", async ({ page }) => {
    test.skip(!client, "Browser client required");
    await voiceFixture(page);
    await page.route("**/api/transcription", route => route.fulfill({ json: route.request().method() === "GET" ? { available: true } : { text: "A recorded draft" } }));
    await page.addInitScript(() => {
      (window as any).wakeLocks = [];
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async (type: string) => {
        const lock = { type, released: false, release: async () => { lock.released = true; } };
        (window as any).wakeLocks.push(lock);
        return lock;
      } } });
    });
    await open(page);
    expect(await page.evaluate(() => (window as any).wakeLocks.length)).toBe(0);
    for (const action of ["finish", "cancel", "pagehide"]) {
      await page.getByRole("button", { name: "Dictate message" }).click();
      await expect.poll(() => page.evaluate(() => (window as any).wakeLocks.filter((lock: any) => !lock.released).map((lock: any) => lock.type))).toEqual(["screen"]);
      if (action === "finish") {
        await expect(page.locator(".voice-duration")).toHaveAttribute("aria-label", "1s / 120s");
        await page.getByRole("button", { name: "Stop recording" }).click();
      } else if (action === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
      else await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await expect.poll(() => page.evaluate(() => (window as any).wakeLocks.every((lock: any) => lock.released))).toBe(true);
      await expect(page.getByRole("button", { name: "Dictate message" })).toBeEnabled();
    }
    expect(await page.evaluate(() => (window as any).wakeLocks.length)).toBe(3);
  });

  test("late wake locks are released and denial or missing support never blocks recording", async ({ page }) => {
    test.skip(!client, "Browser client required");
    await voiceFixture(page);
    await page.route("**/api/transcription", route => route.fulfill({ json: { available: true } }));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => new Promise(resolve => {
        (window as any).grantWakeLock = () => resolve({ release: async () => { (window as any).wakeLockReleased = true; } });
      }) } });
    });
    await open(page);
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => (window as any).grantWakeLock());
    await expect.poll(() => page.evaluate(() => (window as any).wakeLockReleased)).toBe(true);
    for (const supported of [true, false]) {
      await page.evaluate(supported => Object.defineProperty(navigator, "wakeLock", { configurable: true, value: supported ? { request: () => Promise.reject(new DOMException("Power saving", "NotAllowedError")) } : undefined }), supported);
      await page.getByRole("button", { name: "Dictate message" }).click();
      await expect(page.getByRole("img", { name: "Live microphone waveform" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("button", { name: "Dictate message" })).toBeEnabled();
    }
  });

  test("permission wait can be cancelled and transcription errors leave a usable composer", async ({ page }, testInfo) => {
    test.skip(!client, "Browser client required");
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page);
    await page.route("**/api/transcription", route => route.request().method() === "GET"
      ? route.fulfill({ json: { available: true } })
      : route.fulfill({ status: 503, json: { error: "Transcription is unavailable. Please try again." } }));
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        await new Promise<void>(resolve => { (window as any).allowMicrophone = resolve; });
        const stream = await getUserMedia(constraints);
        (window as any).voiceStream = stream;
        return stream;
      };
    });
    await open(page);
    const composer = page.locator(".conversation-composer");
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("status")).toHaveText("Waiting for microphone…");
    await composer.screenshot({ path: testInfo.outputPath("voice-permission-wait.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => (window as any).allowMicrophone());
    await expect.poll(() => page.evaluate(() => (window as any).voiceStream?.getTracks().every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
    await expect(page.getByRole("button", { name: "Type a message", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dictate message" }).click();
    await page.evaluate(() => (window as any).allowMicrophone());
    await expect(page.locator(".voice-duration")).toHaveAttribute("aria-label", "1s / 120s");
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByRole("status")).toContainText("Transcription is unavailable");
    await composer.screenshot({ path: testInfo.outputPath("voice-transcription-error.png") });
    await page.getByRole("button", { name: "Type a message", exact: true }).click();
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(draft).toBeFocused();
    await draft.fill("Please review the microphone controls.");
    await state.status("working");
    await page.getByRole("button", { name: "Dictate message" }).click();
    await page.evaluate(() => (window as any).allowMicrophone());
    await expect(page.getByRole("img", { name: "Live microphone waveform" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 430 });
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeInViewport();
    await expect(draft).toBeInViewport();
    expect(await page.locator(".conversation-reader").evaluate(el => el.clientHeight)).toBeGreaterThan(60);
    await composer.screenshot({ path: testInfo.outputPath("voice-working-small.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await state.status("idle", "stale");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await composer.screenshot({ path: testInfo.outputPath("voice-disconnected.png") });
    await state.status("idle");
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    await page.route("**/api/threads/thread-1/messages", async route => { await gate; await route.fulfill({ status: 503, json: { error: "Agent is unavailable. Your draft is safe." } }); });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Dictate message" })).toBeDisabled();
    await composer.screenshot({ path: testInfo.outputPath("voice-sending.png") });
    finish();
    await expect(page.getByRole("status")).toContainText("Delivery is being checked");
    await expect(draft).toHaveValue("Please review the microphone controls.");
    await composer.screenshot({ path: testInfo.outputPath("voice-send-error.png") });
    expect(state.submissions).toHaveLength(0);
  });

  test("permission denial preserves the draft and missing configuration hides the mic", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    test.skip(!client, "Browser client required");
    const state = await fixture(page);
    let available = true;
    await page.route("**/api/transcription", route => route.fulfill({ json: { available } }));
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
    });
    await open(page);
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await page.getByRole("button", { name: "Type a message", exact: true }).click();
    await draft.fill("Keep this");
    await page.getByRole("button", { name: "Dictate message" }).click();
    await expect(page.getByRole("status")).toContainText("Microphone access was denied");
    await expect(draft).toHaveValue("Keep this");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    expect(state.submissions).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("dictation-permission-error.png") });
    available = false;
    await page.reload();
    await expect(draft).toHaveValue("Keep this");
    await expect(page.getByRole("button", { name: "Dictate message" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("dictation-unavailable.png") });
  });
});
