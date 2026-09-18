import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.ts";

const valid = {
  P14_CLIENT_SECRET: "s".repeat(32),
  P14_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
};

describe("configuration", () => {
  it("loads the bounded local defaults", () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 3014,
      clientId: "p14-ai-scheduling-assistant",
    });
  });

  it("rejects public HTTP and invalid session keys", () => {
    expect(() =>
      loadConfig({ ...valid, P14_BASE_URL: "http://example.com" }),
    ).toThrow(/HTTPS or loopback/u);
    expect(() =>
      loadConfig({ ...valid, P14_SESSION_ENCRYPTION_KEY: "short" }),
    ).toThrow(/32 bytes/u);
  });
});
