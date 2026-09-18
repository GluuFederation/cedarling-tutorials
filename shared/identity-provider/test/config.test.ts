import { describe, expect, it } from "vitest";
import {
  deviceCodeGrantType,
  loadConfig,
  p3McpScopes,
  p4EditorialScopes,
  p5DataScopes,
  p6InspectionScopes,
  p7DocumentScopes,
  p9ChatScopes,
  p10WarehouseScopes,
  p11WorkspaceScopes,
} from "../src/config.js";

const validSecrets = {
  P1_CLIENT_SECRET: "p1".repeat(16),
  P4_CLIENT_SECRET: "p4".repeat(16),
  P5_CLIENT_SECRET: "p5".repeat(16),
  P6_CLIENT_SECRET: "p6".repeat(16),
  P7_CLIENT_SECRET: "p7".repeat(16),
  P8_CLIENT_SECRET: "p8".repeat(16),
  P9_CLIENT_SECRET: "p9".repeat(16),
  P10_TRANSFER_PLANNER_CLIENT_SECRET: "planner".repeat(5),
  P10_WAREHOUSE_NORTH_CLIENT_SECRET: "north".repeat(7),
  P10_WAREHOUSE_SOUTH_CLIENT_SECRET: "south".repeat(7),
  P10_INVENTORY_AUDITOR_CLIENT_SECRET: "auditor".repeat(5),
  P11_CLIENT_SECRET: "p11".repeat(11),
};

describe("tutorial application registry", () => {
  it.each([
    ["P12", "p12-hr-access-governance", 3012, "hr.access"],
    ["P13", "p13-student-records", 3013, "grade.access"],
    ["P14", "p14-ai-scheduling-assistant", 3014, "schedule.access"],
    ["P15", "p15-marketplace", 3015, "refund.access"],
  ] as const)(
    "registers %s without requiring the other new slice clients",
    (prefix, id, port, scope) => {
      const config = loadConfig({
        ...validSecrets,
        [`${prefix}_CLIENT_SECRET`]: "isolated-slice-client-secret".repeat(2),
      });
      const application = config.applications.get(id);
      const origin = `http://${prefix.toLowerCase()}.localhost:${port}`;
      expect(application).toMatchObject({
        clientId: id,
        clientType: "confidential",
        tokenEndpointAuthMethod: "client_secret_basic",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        redirectUris: [`${origin}/auth/callback`],
        postLogoutRedirectUris: [origin],
      });
      expect(application?.resources.get("api")).toEqual({
        audience: `${origin}/api`,
        scopes: [scope],
        accessTokenTtlSeconds: 1_800,
      });
      expect(config.applications.size).toBe(15);
    },
  );

  it("registers P3, P4, and P5 with isolated authentication and resources", () => {
    const config = loadConfig(validSecrets);

    expect([...config.applications.keys()]).toEqual([
      "p1-task-manager",
      "p2-tenantrag",
      "p3-mcp-capability-governance",
      "p4-editorial-publishing",
      "p5-dataguard",
      "p6-field-inspection",
      "p7-collaborative-docs",
      "p8-cedarfile",
      "p9-cedarrealtime",
      "p10-transfer-planner",
      "p10-warehouse-north",
      "p10-warehouse-south",
      "p10-inventory-auditor",
      "p11-saas-workspace",
    ]);

    const p3 = config.applications.get("p3-mcp-capability-governance");
    expect(p3).toMatchObject({
      clientId: "p3-mcp-capability-governance-cli",
      clientType: "public",
      grantTypes: [deviceCodeGrantType],
      responseTypes: [],
      tokenEndpointAuthMethod: "none",
      redirectUris: [],
      postLogoutRedirectUris: [],
    });
    expect(p3?.resources.get("mcp")).toEqual({
      audience: "http://p3.localhost:3003/mcp",
      scopes: p3McpScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const p4 = config.applications.get("p4-editorial-publishing");
    expect(p4).toMatchObject({
      clientId: "p4-editorial-publishing",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p4.localhost:3004/auth/callback"],
      postLogoutRedirectUris: ["http://p4.localhost:3004"],
    });
    expect(p4?.resources.get("api")).toEqual({
      audience: "http://p4.localhost:3004/api",
      scopes: p4EditorialScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const p5 = config.applications.get("p5-dataguard");
    expect(p5).toMatchObject({
      clientId: "p5-dataguard",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p5.localhost:3005/auth/callback"],
      postLogoutRedirectUris: ["http://p5.localhost:3005"],
    });
    expect(p5?.resources.get("api")).toEqual({
      audience: "http://p5.localhost:3005/api",
      scopes: p5DataScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const p6 = config.applications.get("p6-field-inspection");
    expect(p6).toMatchObject({
      clientId: "p6-field-inspection",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p6.localhost:3006/auth/callback"],
      postLogoutRedirectUris: ["http://p6.localhost:3006"],
    });
    expect(p6?.resources.get("api")).toEqual({
      audience: "http://p6.localhost:3006/api",
      scopes: p6InspectionScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const p7 = config.applications.get("p7-collaborative-docs");
    expect(p7).toMatchObject({
      clientId: "p7-collaborative-docs",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p7.localhost:3007/auth/callback"],
      postLogoutRedirectUris: ["http://p7.localhost:3007"],
    });
    expect(p7?.resources.get("api")).toEqual({
      audience: "http://p7.localhost:3007/api",
      scopes: p7DocumentScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const p8 = config.applications.get("p8-cedarfile");
    expect(p8).toMatchObject({
      clientId: "p8-cedarfile",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["http://p8.localhost:3008/auth/callback"],
      postLogoutRedirectUris: ["http://p8.localhost:3008"],
    });
    expect(p8?.resources.get("api")).toEqual({
      audience: "http://p8.localhost:3008/api",
      scopes: ["file.access"],
      accessTokenTtlSeconds: 1_800,
    });

    const p9 = config.applications.get("p9-cedarrealtime");
    expect(p9).toMatchObject({
      clientId: "p9-cedarrealtime",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["http://p9.localhost:3009/auth/callback"],
      postLogoutRedirectUris: ["http://p9.localhost:3009"],
    });
    expect(p9?.resources.get("api")).toEqual({
      audience: "http://p9.localhost:3009/api",
      scopes: p9ChatScopes,
      accessTokenTtlSeconds: 1_800,
    });

    for (const id of [
      "p10-transfer-planner",
      "p10-warehouse-north",
      "p10-warehouse-south",
      "p10-inventory-auditor",
    ]) {
      const workload = config.applications.get(id);
      expect(workload).toMatchObject({
        clientId: id,
        clientType: "confidential",
        grantTypes: ["client_credentials"],
        responseTypes: [],
        redirectUris: [],
        postLogoutRedirectUris: [],
      });
      expect(workload?.resources.get("api")).toEqual({
        audience: "http://p10.localhost:3010/api",
        scopes: p10WarehouseScopes,
        accessTokenTtlSeconds: 300,
      });
    }

    const p11 = config.applications.get("p11-saas-workspace");
    expect(p11).toMatchObject({
      clientId: "p11-saas-workspace",
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["http://p11.localhost:3011/auth/callback"],
      postLogoutRedirectUris: ["http://p11.localhost:3011"],
    });
    expect(p11?.resources.get("api")).toEqual({
      audience: "http://p11.localhost:3011/api",
      scopes: p11WorkspaceScopes,
      accessTokenTtlSeconds: 1_800,
    });

    const clientResources = [...config.applications.values()].flatMap(
      (application) =>
        [...application.resources.values()].map(
          (resource) => `${application.clientId}\0${resource.audience}`,
        ),
    );
    expect(new Set(clientResources).size).toBe(clientResources.length);
    expect(
      new Set(
        [
          "p10-transfer-planner",
          "p10-warehouse-north",
          "p10-warehouse-south",
          "p10-inventory-auditor",
        ].map(
          (id) => config.applications.get(id)?.resources.get("api")?.audience,
        ),
      ),
    ).toEqual(new Set(["http://p10.localhost:3010/api"]));
  });

  it("uses explicitly supplied client and endpoint values", () => {
    const config = loadConfig({
      ...validSecrets,
      P3_CLIENT_ID: "p3-custom",
      P3_MCP_RESOURCE: "http://localhost:3303/mcp/",
      P4_CLIENT_ID: "p4-custom",
      P4_REDIRECT_URI: "http://localhost:3304/callback/",
      P4_POST_LOGOUT_REDIRECT_URI: "http://localhost:3304/",
      P4_API_RESOURCE: "http://localhost:3304/api/",
      P5_CLIENT_ID: "p5-custom",
      P5_REDIRECT_URI: "http://localhost:3305/callback/",
      P5_POST_LOGOUT_REDIRECT_URI: "http://localhost:3305/",
      P5_API_RESOURCE: "http://localhost:3305/api/",
    });

    expect(
      config.applications.get("p3-mcp-capability-governance"),
    ).toMatchObject({
      clientId: "p3-custom",
    });
    expect(
      config.applications
        .get("p3-mcp-capability-governance")
        ?.resources.get("mcp")?.audience,
    ).toBe("http://localhost:3303/mcp");
    expect(config.applications.get("p4-editorial-publishing")).toMatchObject({
      clientId: "p4-custom",
      redirectUris: ["http://localhost:3304/callback"],
      postLogoutRedirectUris: ["http://localhost:3304"],
    });
    expect(config.applications.get("p5-dataguard")).toMatchObject({
      clientId: "p5-custom",
      redirectUris: ["http://localhost:3305/callback"],
      postLogoutRedirectUris: ["http://localhost:3305"],
    });
  });

  it.each(["P12", "P13", "P14", "P15"])(
    "honors isolated %s endpoints and rejects an empty secret",
    (prefix) => {
      const project = {
        P12: "p12-hr-access-governance",
        P13: "p13-student-records",
        P14: "p14-ai-scheduling-assistant",
        P15: "p15-marketplace",
      }[prefix];
      if (!project) throw new Error("Unknown test project");
      const env = {
        ...validSecrets,
        [`${prefix}_CLIENT_ID`]: "isolated-client",
        [`${prefix}_CLIENT_SECRET`]: "isolated-client-secret".repeat(2),
        [`${prefix}_REDIRECT_URI`]: "http://127.0.0.1:49000/auth/callback",
        [`${prefix}_POST_LOGOUT_REDIRECT_URI`]: "http://127.0.0.1:49000",
        [`${prefix}_API_RESOURCE`]: "http://127.0.0.1:49000/api",
      };
      const application = loadConfig(env).applications.get(project);
      expect(application).toMatchObject({
        clientId: "isolated-client",
        redirectUris: ["http://127.0.0.1:49000/auth/callback"],
        postLogoutRedirectUris: ["http://127.0.0.1:49000"],
      });
      expect(application?.resources.get("api")?.audience).toBe(
        "http://127.0.0.1:49000/api",
      );
      expect(() =>
        loadConfig({ ...env, [`${prefix}_CLIENT_SECRET`]: "" }),
      ).toThrow(`${prefix}_CLIENT_SECRET is required`);
      expect(() =>
        loadConfig({ ...env, [`${prefix}_CLIENT_SECRET`]: "short" }),
      ).toThrow("at least 32 characters");
    },
  );

  it("rejects an unknown identity-provider profile", () => {
    expect(() => loadConfig({ IDP_PROFILE: "unknown" })).toThrow(
      "IDP_PROFILE must be default",
    );
  });
  it.each([
    "P1_CLIENT_SECRET",
    "P4_CLIENT_SECRET",
    "P5_CLIENT_SECRET",
    "P6_CLIENT_SECRET",
    "P7_CLIENT_SECRET",
    "P8_CLIENT_SECRET",
    "P9_CLIENT_SECRET",
    "P10_TRANSFER_PLANNER_CLIENT_SECRET",
    "P10_WAREHOUSE_NORTH_CLIENT_SECRET",
    "P10_WAREHOUSE_SOUTH_CLIENT_SECRET",
    "P10_INVENTORY_AUDITOR_CLIENT_SECRET",
    "P11_CLIENT_SECRET",
  ])("requires a strong %s", (name) => {
    expect(() => loadConfig({ ...validSecrets, [name]: "too-short" })).toThrow(
      `${name} must contain at least 32 characters`,
    );
  });
});
