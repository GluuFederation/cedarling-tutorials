import { defineConfig } from "@playwright/test";

const externalStack = process.env.P11_E2E_EXTERNAL === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://localhost:17011",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  ...(externalStack
    ? {}
    : {
        webServer: {
          command: "pnpm dev -- --reset",
          gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
          url: "http://127.0.0.1:17011/health",
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
