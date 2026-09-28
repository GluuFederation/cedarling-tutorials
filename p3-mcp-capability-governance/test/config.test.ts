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
    expect(config.port).toBe(3003);
    expect(config.issuer).toBe("http://idp.localhost:4000");
    expect(config.mcpResource).toBe("http://p3.localhost:3003/mcp");
    expect(config.openRouterApiKey).toBeUndefined();
  });

  it("rejects invalid ports and resource URI fragments", () => {
    expect(() => loadConfig({ P3_PORT: "0" })).toThrow("P3_PORT");
    expect(() =>
      loadConfig({ P3_MCP_RESOURCE: "http://p3.localhost:3003/mcp#token" }),
    ).toThrow("fragment");
  });

  it("allows HTTP for loopback tutorial hosts", () => {
    for (const hostname of [
      "localhost",
      "idp.localhost",
      "127.0.0.1",
      "[::1]",
    ]) {
      expect(() =>
        loadConfig({
          P3_ISSUER: `http://${hostname}:4000`,
          P3_MCP_RESOURCE: `http://${hostname}:3003/mcp`,
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
    expect(() => loadConfig({ P3_ISSUER: "http://192.168.1.20:4000" })).toThrow(
      "P3_ISSUER must use https outside loopback",
    );
  });
});
