import { describe, expect, it } from "vitest";
import {
  loadConfig,
  MCP_PROTOCOL_VERSION,
} from "../src/config/project-config.js";

describe("P3 configuration", () => {
  it("uses the locked protocol and local service configuration", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(17003);
    expect(config.issuer).toBe("http://localhost:18003");
    expect(config.mcpResource).toBe("http://localhost:17003/mcp");
    expect(config.openRouterApiKey).toBeUndefined();
    expect(config.openRouterModel).toBe("liquid/lfm-2.5-2.6b:free");
    expect(config.openRouterAllowPaid).toBe(false);
  });

  it("allows an alternate model with an explicit paid-routing switch", () => {
    const config = loadConfig({
      P3_OPENROUTER_MODEL: "vendor/selected-model",
      P3_OPENROUTER_ALLOW_PAID: "true",
    });
    expect(config.openRouterModel).toBe("vendor/selected-model");
    expect(config.openRouterAllowPaid).toBe(true);
    expect(() => loadConfig({ P3_OPENROUTER_MODEL: " " })).toThrow(
      "P3_OPENROUTER_MODEL",
    );
    expect(() =>
      loadConfig({ P3_OPENROUTER_MODEL: "vendor/selected-model" }),
    ).toThrow("P3_OPENROUTER_ALLOW_PAID=true");
    expect(() => loadConfig({ P3_OPENROUTER_ALLOW_PAID: "yes" })).toThrow(
      "P3_OPENROUTER_ALLOW_PAID",
    );
  });

  it("reads the container bind address and bounded provider settings", () => {
    expect(
      loadConfig({
        P3_HOST: "0.0.0.0",
        P3_OPENROUTER_API_KEY: " test-key ",
        P3_PROVIDER_TIMEOUT_MS: "60000",
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      openRouterApiKey: "test-key",
      providerTimeoutMs: 60000,
    });
  });

  it.each(["", "999", "60001", "15000ms", "1500.5", "NaN", "Infinity"])(
    "rejects invalid provider timeout %j",
    (value) => {
      expect(() => loadConfig({ P3_PROVIDER_TIMEOUT_MS: value })).toThrow(
        "P3_PROVIDER_TIMEOUT_MS",
      );
    },
  );
});
