import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 15_000,
  // Live checks intentionally share one isolated Herdr pane.
  workers: 1,
  use: {
    browserName: (process.env.HERDR_CONTROL_TEST_BROWSER as "chromium" | "webkit" | undefined) ?? "chromium",
    headless: true,
  },
});
