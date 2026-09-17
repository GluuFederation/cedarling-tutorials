import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    testTimeout: 10000,
  },
  oxc: { jsx: { runtime: "automatic" } },
});
