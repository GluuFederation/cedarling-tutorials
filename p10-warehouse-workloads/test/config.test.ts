import { describe, expect, it } from "vitest";
import {
  loadAgentConfig,
  loadApiConfig,
  loadConsoleConfig,
} from "../src/server/config.ts";

const common = {
  P10_ISSUER: "http://idp.localhost:4000",
  P10_API_RESOURCE: "http://p10.localhost:3010/api",
  P10_CONTROL_SECRET: "control-secret-that-is-at-least-32-characters",
};

describe("runtime configuration", () => {
  it("loads each process from only the settings that process owns", () => {
    expect(loadApiConfig(common)).toMatchObject({
      port: 3110,
      issuer: common.P10_ISSUER,
    });
    expect(loadConsoleConfig(common).agentUrls["warehouse-south"]).toBe(
      "http://127.0.0.1:3113",
    );
    expect(
      loadAgentConfig("warehouse-north", {
        ...common,
        P10_WAREHOUSE_NORTH_CLIENT_ID: "p10-warehouse-north",
        P10_WAREHOUSE_NORTH_CLIENT_SECRET:
          "north-secret-that-is-at-least-32-characters",
      }),
    ).toMatchObject({
      workloadId: "warehouse-north",
      clientId: "p10-warehouse-north",
      port: 3112,
    });
  });

  it("rejects public plain HTTP endpoints and missing workload credentials", () => {
    expect(() =>
      loadApiConfig({ ...common, P10_ISSUER: "http://example.com" }),
    ).toThrow("P10_ISSUER must be HTTPS or loopback HTTP");
    expect(() => loadAgentConfig("inventory-auditor", common)).toThrow(
      "P10_INVENTORY_AUDITOR_CLIENT_ID is required",
    );
    expect(() =>
      loadApiConfig({
        ...common,
        P10_TRANSFER_PLANNER_CLIENT_ID: "duplicate-client",
        P10_WAREHOUSE_NORTH_CLIENT_ID: "duplicate-client",
      }),
    ).toThrow("P10 workload client IDs must be unique");
  });
});
