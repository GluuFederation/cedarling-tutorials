import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "../shared/browser-test-stack.mjs",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:17004",
    trace: "retain-on-failure",
  },
});
