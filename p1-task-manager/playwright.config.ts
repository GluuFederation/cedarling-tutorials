import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "../shared/browser-test-stack.mjs",
  timeout: 45_000,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:17001",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
});
