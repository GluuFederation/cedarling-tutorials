import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://p4.localhost:3004",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/dev.mjs --reset",
    url: "http://127.0.0.1:3004/health",
    reuseExistingServer: false,
    timeout: 90_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
