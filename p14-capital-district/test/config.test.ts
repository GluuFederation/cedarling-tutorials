import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config/environment.ts";

const environment = {
  P14_CLIENT_SECRET: "s".repeat(32),
  P14_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
};
describe("P14 runtime configuration", () => {
  it("uses the current project and documented native ports", () => {
    const config = loadConfig(environment);
    expect(config.clientId).toBe("p14-capital-district");
    expect(config.baseUrl).toBe("http://localhost:17014");
    expect(config.issuer).toBe("http://localhost:18014");
  });
  it("derives the default origin from a custom port", () =>
    expect(loadConfig({ ...environment, P14_PORT: "17114" }).baseUrl).toBe(
      "http://localhost:17114",
    ));
  it("accepts an explicitly configured HTTPS default port", () =>
    expect(
      loadConfig({
        ...environment,
        P14_PORT: "443",
        P14_BASE_URL: "https://example.test",
      }).baseUrl,
    ).toBe("https://example.test"));
  it.each([
    { P14_BASE_URL: "http://example.test:17014" },
    { P14_BASE_URL: "http://localhost:17014/game" },
    { P14_BASE_URL: "http://localhost:17014?next=outside" },
    { P14_BASE_URL: "http://account:password@localhost:17014" },
    { P14_ISSUER: "http://example.test:18014" },
    { P14_API_RESOURCE: "http://localhost:17014/other" },
    { P14_PORT: "-1" },
    { P14_PORT: "65536" },
    { P14_HOST: "example.test" },
    { P14_BASE_URL: "http://localhost:17015" },
    { P14_CLIENT_SECRET: "short" },
    { P14_SESSION_ENCRYPTION_KEY: "!".repeat(43) },
    { P14_DATA_DIR: ".local" },
    { P14_DATA_DIR: "../unrelated" },
  ])("rejects unsafe or inconsistent configuration: %j", (change) =>
    expect(() => loadConfig({ ...environment, ...change })).toThrow(),
  );
});
