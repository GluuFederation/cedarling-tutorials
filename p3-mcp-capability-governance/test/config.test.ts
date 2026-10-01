import { describe, expect, it } from "vitest";
import {
  loadConfig,
  MCP_PROTOCOL_VERSION,
} from "../src/config/project-config.js";

describe("P3 configuration", () => {
  it("uses the locked protocol and local service defaults", () => {
    const config = loadConfig({});

    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
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

  it("rejects invalid ports and resource URI fragments", () => {
    expect(() => loadConfig({ P3_PORT: "0" })).toThrow("P3_PORT");
    expect(() => loadConfig({ P3_PORT: "17003junk" })).toThrow("P3_PORT");
    expect(() =>
      loadConfig({ P3_MCP_RESOURCE: "http://localhost:17003/mcp#token" }),
    ).toThrow("fragment");
  });

  it("allows HTTP for loopback tutorial hosts", () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(() =>
        loadConfig({
          P3_ISSUER: `http://${hostname}:18003`,
          P3_MCP_RESOURCE: `http://${hostname}:17003/mcp`,
        }),
      ).not.toThrow();
    }
  });

  it("allows HTTPS issuers and MCP resources on remote hosts", () => {
    const config = loadConfig({
      P3_ISSUER: "https://identity.example.com",
      P3_MCP_RESOURCE: "https://mcp.example.com/mcp",
    });

    expect(config.issuer).toBe("https://identity.example.com");
    expect(config.mcpResource).toBe("https://mcp.example.com/mcp");
  });

  it("rejects non-loopback HTTP issuers and MCP resources", () => {
    expect(() =>
      loadConfig({ P3_ISSUER: "http://identity.example.com" }),
    ).toThrow("P3_ISSUER must use https outside loopback");
    expect(() =>
      loadConfig({ P3_MCP_RESOURCE: "http://mcp.example.com/mcp" }),
    ).toThrow("P3_MCP_RESOURCE must use https outside loopback");
    expect(() =>
      loadConfig({ P3_ISSUER: "http://192.168.1.20:18003" }),
    ).toThrow("P3_ISSUER must use https outside loopback");
  });
});
