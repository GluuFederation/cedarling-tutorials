import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.ts";

const valid = {
  P6_BASE_URL: "http://p6.localhost:3006",
  P6_ISSUER: "http://idp.localhost:4000",
  P6_API_RESOURCE: "http://p6.localhost:3006/api",
  P6_CLIENT_ID: "p6-field-inspection",
  P6_CLIENT_SECRET: "s".repeat(43),
  P6_DATA_DIR: ".local/test-data",
} satisfies NodeJS.ProcessEnv;

describe("P6 configuration", () => {
  it("accepts the bounded native configuration", () => {
    expect(loadConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 3006,
      baseUrl: "http://p6.localhost:3006",
      issuer: "http://idp.localhost:4000",
      apiResource: "http://p6.localhost:3006/api",
      clientId: "p6-field-inspection",
      clientSecret: "s".repeat(43),
      dataDirectory: resolve(".local/test-data"),
    });
  });

  it("rejects public HTTP, mismatched ports, and data outside .local", () => {
    expect(() =>
      loadConfig({ ...valid, P6_ISSUER: "http://example.test" }),
    ).toThrow("P6_ISSUER must be HTTPS or loopback HTTP without extras");
    expect(() => loadConfig({ ...valid, P6_PORT: "3016" })).toThrow(
      "P6_BASE_URL must match P6_PORT",
    );
    expect(() => loadConfig({ ...valid, P6_DATA_DIR: "../outside" })).toThrow(
      "P6_DATA_DIR must be inside this project's .local directory",
    );
  });
});
