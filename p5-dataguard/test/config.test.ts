import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/server/config.ts";

const environment = {
  P5_CLIENT_SECRET: "c".repeat(32),
  P5_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
};

describe("application origin", () => {
  test("uses the registered port pair", () => {
    expect(loadConfig(environment)).toMatchObject({
      port: 17005,
      baseUrl: "http://localhost:17005",
      issuer: "http://localhost:18005",
    });
  });
  test("rejects a listen port that differs from the public URL", () => {
    expect(() => loadConfig({ ...environment, P5_PORT: "3005" })).toThrow(
      "P5_PORT must match P5_BASE_URL",
    );
  });
});
