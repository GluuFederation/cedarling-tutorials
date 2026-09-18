import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/project-config.js";
import { loadProjectEnvironment } from "../src/config/environment.js";

const validEnvironment = {
  P2_VOYAGE_API_KEY: "voyage-test-key",
  P2_OPENROUTER_API_KEY: "openrouter-test-key",
};

describe("P2 configuration", () => {
  it("uses safe local defaults and the project root", () => {
    const config = loadConfig(validEnvironment, "/tutorial/p2-tenantrag");
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      baseUrl: "http://p2.localhost:3000",
      issuer: "http://idp.localhost:4000",
      apiResource: "http://p2.localhost:3000/api",
      clientId: "p2-tenantrag-cli",
      voyageModel: "voyage-4-lite",
      voyageDimensions: 256,
      openRouterModel: "openrouter/free",
    });
    expect(config.fixturesDirectory).toBe(
      resolve("/tutorial/p2-tenantrag", "fixtures"),
    );
    expect(config.artifactPath).toBe(
      resolve("/tutorial/p2-tenantrag", "data/orama-index.json"),
    );
  });

  it("requires both provider keys", () => {
    expect(() => loadConfig({ P2_OPENROUTER_API_KEY: "present" })).toThrow(
      "P2_VOYAGE_API_KEY is required",
    );
    expect(() => loadConfig({ P2_VOYAGE_API_KEY: "present" })).toThrow(
      "P2_OPENROUTER_API_KEY is required",
    );
  });

  it("rejects unsafe or invalid configuration", () => {
    expect(() => loadConfig({ ...validEnvironment, P2_PORT: "0" })).toThrow(
      "P2_PORT",
    );
    expect(() =>
      loadConfig({ ...validEnvironment, P2_BASE_URL: "file:///tmp/p2" }),
    ).toThrow("P2_BASE_URL must use http or https");
    expect(() =>
      loadConfig({ ...validEnvironment, P2_VOYAGE_DIMENSIONS: "512" }),
    ).toThrow("P2_VOYAGE_DIMENSIONS");
  });
});

describe("P2 environment", () => {
  it("loads only the project-local environment file", () => {
    const load = vi.fn();
    const expected = resolve("/tutorial/p2-tenantrag", ".env");
    expect(
      loadProjectEnvironment("/tutorial/p2-tenantrag", {
        exists: (path) => path === expected,
        load,
      }),
    ).toBe(expected);
    expect(load).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("does not search parent or sibling environments", () => {
    const load = vi.fn();
    expect(
      loadProjectEnvironment("/tutorial/p2-tenantrag", {
        exists: () => false,
        load,
      }),
    ).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
