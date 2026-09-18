import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "../src/server/api-app.ts";
import type { AuthorizationRequest } from "../src/server/authorization.ts";
import { WarehouseDatabase } from "../src/server/database.ts";

const databases: WarehouseDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const verifier = {
  verify: async () => ({ workloadId: "inventory-auditor" as const }),
};

describe("Warehouse API", () => {
  it("authorizes transfer-list candidates independently", async () => {
    const database = new WarehouseDatabase(":memory:");
    databases.push(database);
    const decisions: AuthorizationRequest[] = [];
    const app = await createApiApp({
      database,
      verifier,
      authorization: {
        authorize: async (request) => {
          decisions.push(request);
          return request.resourceId !== "trf_south_north_transit";
        },
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/transfers",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.json().transfers).toHaveLength(2);
    expect(decisions).toHaveLength(3);
    expect(decisions[0]).toMatchObject({
      workloadId: "inventory-auditor",
      capability: "transfer.read",
      action: "Transfer::Read",
      accessToken: "valid-token",
    });
    await app.close();
  });

  it("reproduces the auditor-create baseline gap at the API effect boundary", async () => {
    const database = new WarehouseDatabase(":memory:");
    databases.push(database);
    const app = await createApiApp({
      database,
      verifier,
      authorization: { authorize: async () => true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/transfers",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      payload: {
        sourceId: "north",
        destinationId: "south",
        skuId: "sensor-pack",
        quantity: 3,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transfer.createdBy).toBe("inventory-auditor");
    await app.close();
  });

  it("rejects malformed JSON before authentication", async () => {
    const database = new WarehouseDatabase(":memory:");
    databases.push(database);
    const app = await createApiApp({
      database,
      verifier: { verify: async () => Promise.reject(new Error("not called")) },
      authorization: { authorize: async () => true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/transfers",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("body_invalid");
    await app.close();
  });

  it("does not distinguish an absent transfer from a denied transfer", async () => {
    const database = new WarehouseDatabase(":memory:");
    databases.push(database);
    const app = await createApiApp({
      database,
      verifier,
      authorization: { authorize: async () => false },
    });
    const headers = { authorization: "Bearer valid-token" };
    const denied = await app.inject({
      method: "GET",
      url: "/api/transfers/trf_north_south_planned",
      headers,
    });
    const absent = await app.inject({
      method: "GET",
      url: "/api/transfers/trf_absent",
      headers,
    });
    expect(denied.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    expect(denied.json().error).toBe("transfer_not_found");
    expect(absent.json().error).toBe("transfer_not_found");
    await app.close();
  });

  it("returns a stable request ID for unsupported routes", async () => {
    const database = new WarehouseDatabase(":memory:");
    databases.push(database);
    const app = await createApiApp({
      database,
      verifier,
      authorization: { authorize: async () => true },
    });
    const response = await app.inject({ method: "GET", url: "/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "not_found",
      requestId: expect.any(String),
    });
    await app.close();
  });
});
