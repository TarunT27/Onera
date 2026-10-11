import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";
const port = 3101;
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "clearfi-playwright-results"),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1487, height: 1058 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CLEARFI_NEXT_DIR: ".next-e2e",
      CLEARFI_DB_PATH: path.join(os.tmpdir(), `clearfi-e2e-${process.pid}.db`),
      ANTHROPIC_API_KEY: "",
      // Keep e2e runs deterministic: no in-process background agents.
      CLEARFI_BACKGROUND: "off",
    },
  },
});
