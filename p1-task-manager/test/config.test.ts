import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/server/config.js";

const environment = {
  P1_CLIENT_SECRET: "s".repeat(32),
  P1_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
};

describe("fixed P1 policy trust", () => {
  test("rejects a listen port that disagrees with the public URL", () => {
    expect(() => loadConfig({ ...environment, P1_PORT: "3000" })).toThrow(
      "P1_PORT must match P1_BASE_URL",
    );
  });
  test("accepts the assigned issuer and audience", () => {
    expect(loadConfig(environment)).toMatchObject({
      issuer: "http://localhost:18001",
      apiResource: "http://localhost:17001/api",
    });
  });
  test.each([
    { P1_ISSUER: "http://localhost:19001" },
    { P1_API_RESOURCE: "http://localhost:17001/other" },
  ])("rejects mismatched trust before startup: %j", (override) => {
    expect(() => loadConfig({ ...environment, ...override })).toThrow(
      "P1 policies require issuer",
    );
  });
});
