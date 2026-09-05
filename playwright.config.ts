import { defineConfig } from "@playwright/test";

const mocked = process.env.HERDR_CONTROL_TEST_MOCK === "1";
if (mocked) process.env.HERDR_CONTROL_TEST_CLIENT = "http://127.0.0.1:5194";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 15_000,
  // Live checks intentionally share one isolated Herdr pane.
  workers: 1,
  webServer: mocked ? {
    command: "npm run dev:client -- --host 127.0.0.1 --port 5194 --strictPort",
    url: "http://127.0.0.1:5194",
    reuseExistingServer: false,
  } : undefined,
  use: {
    browserName: (process.env.HERDR_CONTROL_TEST_BROWSER as "chromium" | "webkit" | undefined) ?? "chromium",
    headless: true,
  },
});
