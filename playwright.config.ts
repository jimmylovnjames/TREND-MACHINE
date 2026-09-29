import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a PRODUCTION build (`next build` first) backed by a real
 * Postgres database. Set E2E_DATABASE_URL (default: local postgres tm/tm).
 */
const PORT = 3200;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://tm:tm@127.0.0.1:5432/trend_machine_e2e";
export const E2E_SECRET = "e2e-secret-e2e-secret-e2e-secret-0123456789";
export const E2E_ADMIN_TOKEN = "e2e-admin-token-e2e-admin-token-0123456789";
export const E2E_STORAGE = ".data/e2e-storage";

// Use the pre-installed Chromium when the bundled one isn't present (sandboxed CI images).
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium"].find((p) => existsSync(p));

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
      testIgnore: /desktop\.spec\.ts/,
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /desktop\.spec\.ts/ },
  ],
  webServer: {
    command: `npx tsx --conditions=react-server scripts/e2e-prepare.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_SECRET: E2E_SECRET,
      ADMIN_TOKEN: E2E_ADMIN_TOKEN,
      LOCAL_STORAGE_DIR: E2E_STORAGE,
      CRON_SECRET: "e2e-cron-secret-e2e-cron-secret-0123",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
