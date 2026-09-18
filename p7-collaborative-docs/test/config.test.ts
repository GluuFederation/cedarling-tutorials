import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.ts";

const valid = {
  P7_BASE_URL: "http://p7.localhost:3007",
  P7_ISSUER: "http://idp.localhost:4000",
  P7_API_RESOURCE: "http://p7.localhost:3007/api",
  P7_CLIENT_ID: "p7-collaborative-docs",
  P7_CLIENT_SECRET: "s".repeat(43),
  P7_DATA_DIR: ".local/test-data",
} satisfies NodeJS.ProcessEnv;

describe("P7 configuration", () => {
  it("accepts the bounded native configuration", () => {
    expect(loadConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 3007,
      baseUrl: "http://p7.localhost:3007",
      issuer: "http://idp.localhost:4000",
      apiResource: "http://p7.localhost:3007/api",
      clientId: "p7-collaborative-docs",
      clientSecret: "s".repeat(43),
      dataDirectory: resolve(".local/test-data"),
    });
  });

  it("rejects public HTTP, mismatched ports, and data outside .local", () => {
    expect(() =>
      loadConfig({ ...valid, P7_ISSUER: "http://example.test" }),
    ).toThrow("P7_ISSUER must be HTTPS or loopback HTTP without extras");
    expect(() => loadConfig({ ...valid, P7_PORT: "3017" })).toThrow(
      "P7_BASE_URL must match P7_PORT",
    );
    expect(() => loadConfig({ ...valid, P7_DATA_DIR: "../outside" })).toThrow(
      "P7_DATA_DIR must be inside this project's .local directory",
    );
  });
});
