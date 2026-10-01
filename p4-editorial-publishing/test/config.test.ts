import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/server/config.ts";

const environment = {
  NODE_ENV: "test" as const,
  P4_CLIENT_SECRET: "c".repeat(32),
  P4_SESSION_SECRET: "s".repeat(32),
};

describe("application origin", () => {
  test("uses the registered port pair", () => {
    expect(loadConfig(environment)).toMatchObject({
      port: 17004,
      baseUrl: "http://localhost:17004",
      issuer: "http://localhost:18004",
    });
  });
  test("rejects a listen port that differs from the public URL", () => {
    expect(() => loadConfig({ ...environment, P4_PORT: "3004" })).toThrow(
      "P4_PORT must match P4_BASE_URL",
    );
  });
});
