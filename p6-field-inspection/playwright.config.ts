import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://p6.localhost:3006",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev -- --reset",
    gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
    url: "http://127.0.0.1:3006/healthz",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
