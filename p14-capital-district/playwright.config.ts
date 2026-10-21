import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "../shared/browser-test-stack.mjs",
  timeout: 60000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://localhost:17014",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
});
