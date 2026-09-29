import { describe, expect, it } from "vitest";
import { loadConfig, deviceCodeGrantType } from "../src/config.js";
import { projects, projectSettings, workloads } from "../src/projects.js";

describe("project-local identity registration", () => {
  it.each(projects)(
    "registers only $id with its own issuer",
    ({ number, id }) => {
      const prefix = `P${number}`;
      const secrets =
        number === 10
          ? Object.fromEntries(
              workloads.map((w) => [
                `${w.prefix}_CLIENT_SECRET`,
                w.id.repeat(3),
              ]),
            )
          : { [`${prefix}_CLIENT_SECRET`]: "test-client-secret".repeat(3) };
      const config = loadConfig({ IDP_PROJECT: prefix, ...secrets });
      expect(config.project).toBe(prefix);
      expect(config.issuer).toBe(`http://localhost:${18000 + number}`);
      expect(config.port).toBe(18000 + number);
      expect([...config.applications.keys()]).toEqual(
        number === 10 ? workloads.map((w) => w.id) : [id],
      );
      for (const client of config.applications.values()) {
        const resource = client.resources.get(number === 3 ? "mcp" : "api");
        expect(resource?.audience).toBe(
          `http://localhost:${17000 + number}/${number === 3 ? "mcp" : "api"}`,
        );
        expect(resource?.accessTokenTtlSeconds).toBe(
          [1, 10].includes(number) ? 300 : 1800,
        );
        expect(resource?.scopes.length).toBeGreaterThan(0);
        expect(client.grantTypes).toEqual(
          number === 10
            ? ["client_credentials"]
            : [2, 3].includes(number)
              ? [deviceCodeGrantType]
              : ["authorization_code", "refresh_token"],
        );
        expect(client.redirectUris).toEqual(
          [2, 3, 10].includes(number)
            ? []
            : [`http://localhost:${17000 + number}/auth/callback`],
        );
      }
    },
  );

  it("accepts device clients without any confidential client secret", () => {
    for (const IDP_PROJECT of ["P2", "P3"])
      expect(
        [...loadConfig({ IDP_PROJECT }).applications.values()][0]?.clientType,
      ).toBe("public");
  });

  it("honors explicitly configured endpoints and validates secrets", () => {
    const env = {
      IDP_PROJECT: "P4",
      P4_CLIENT_SECRET: "test-secret".repeat(4),
      IDP_ISSUER: "http://localhost:19004",
      IDP_PORT: "19004",
      P4_CLIENT_ID: "custom-client",
      P4_REDIRECT_URI: "http://localhost:19044/auth/callback",
      P4_POST_LOGOUT_REDIRECT_URI: "http://localhost:19044/",
      P4_API_RESOURCE: "http://localhost:19044/api/",
    };
    const config = loadConfig(env);
    expect(config.issuer).toBe(env.IDP_ISSUER);
    expect(config.port).toBe(19004);
    expect(config.applications.get("p4-editorial-publishing")).toMatchObject({
      clientId: "custom-client",
      redirectUris: [env.P4_REDIRECT_URI],
      postLogoutRedirectUris: ["http://localhost:19044"],
    });
    expect(() => loadConfig({ ...env, P4_CLIENT_SECRET: "" })).toThrow(
      "P4_CLIENT_SECRET is required",
    );
    expect(() => loadConfig({ ...env, P4_CLIENT_SECRET: "short" })).toThrow(
      "at least 32 characters",
    );
    expect(() => loadConfig({ ...env, IDP_PORT: "0" })).toThrow(
      "valid TCP port",
    );
  });

  it.each([undefined, "", "P0", "P16", "P01"])(
    "rejects invalid project %s",
    (selector) => {
      expect(() => projectSettings(selector)).toThrow("IDP_PROJECT");
    },
  );
});
