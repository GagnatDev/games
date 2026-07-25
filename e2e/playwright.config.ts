import { defineConfig, devices } from "@playwright/test";

/** Fixed port so `baseURL` is known before global setup runs. */
export const PORT = 8099;

export default defineConfig({
  testDir: "./src",
  globalSetup: "./src/global-setup.ts",
  // AUTH_MODE=dev means one fixed player, so the suite must not run in parallel.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 30_000,
  reporter: process.env["CI"] ? [["html"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Escape hatch for sandboxes and images that ship their own Chromium instead
    // of the revision this Playwright version downloads.
    ...(process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
      ? {
          launchOptions: {
            executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"],
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
