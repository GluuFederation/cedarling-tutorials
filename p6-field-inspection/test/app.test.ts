import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import type {
  AuthorizationPort,
  AuthorizationRequest,
} from "../src/server/authorization.ts";
import { fakeAuthorization } from "../src/server/authorization.ts";
import type { Config } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { type Capability, capabilities } from "../src/shared/capabilities.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];
const applications: FastifyInstance[] = [];
const config: Config = {
  host: "127.0.0.1",
  port: 17006,
  baseUrl: "http://localhost:17006",
  issuer: "http://localhost:18006",
  apiResource: "http://localhost:17006/api",
  clientId: "p6-field-inspection",
  clientSecret: "s".repeat(43),
  dataDirectory: resolve(".local/test-data"),
};
const oidc: OidcRuntime = {
  authorizationUrl: async () => new URL("http://localhost:18006/auth"),
  exchange: async () => ({ subject: "elena", expiresAt: Date.now() + 60_000 }),
};

function fixture(authorization: AuthorizationPort) {
  const directory = mkdtempSync(resolve(tmpdir(), "p6-app-"));
  directories.push(directory);
  const database = new AppDatabase(
    resolve(directory, "test.sqlite"),
    config.issuer,
  );
  databases.push(database);
  const created = database.createSession("user-elena", Date.now() + 60_000);
  return {
    database,
    cookie: `p6_session=${created.id}`,
    csrf: created.session.csrfToken,
    app: createApp({ config, database, oidc, authorization, serveWeb: false }),
  };
}

function allowAll(seen: AuthorizationRequest[] = []): AuthorizationPort {
  return {
    async authorize(request) {
      seen.push(request);
      return true;
    },
    async authorizeMany(requests) {
      seen.push(...requests);
      return Object.fromEntries(
        requests.map((request) => [request.capability, true]),
      ) as Readonly<Record<Capability, boolean>>;
    },
  };
}

afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P6 HTTP boundary", () => {
  it("keeps all six baseline gaps and reports actual mutation decisions separately from HTTP outcomes", async () => {
    const f = fixture(fakeAuthorization());
    const app = await f.app;
    applications.push(app);
    const headers = {
      cookie: f.cookie,
      origin: config.baseUrl,
      "x-csrf-token": f.csrf,
    };
    const get = (id: string) =>
      app.inject({ method: "GET", url: `/api/work-orders/${id}`, headers });
    // A technician can read another assignment and create/delete an order.
    expect((await get("wo-generator-04")).statusCode).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/work-orders",
      headers,
      payload: {
        equipment: "Test fan",
        site: "North Plant",
        technicianId: "user-elena",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["x-authorization-decision"]).toBe("FAKE ALLOW");
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/work-orders/${created.json().workOrder.id}`,
      headers,
      payload: { expectedWorkOrderVersion: 1, expectedAssignmentEpoch: 1 },
    });
    expect(removed.statusCode).toBe(204);
    expect(removed.headers["x-request-id"]).toBeTypeOf("string");
    expect(removed.headers["x-authorization-capability"]).toBe(
      capabilities.delete,
    );
    const reassigned = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/reassignment",
      headers,
      payload: { technicianId: "user-malik", expectedAssignmentEpoch: 1 },
    });
    expect(reassigned.statusCode).toBe(200);
    expect(
      (await get("wo-pump-17")).json().assignmentHistory[0].changedBy,
    ).toBe("Elena Rossi");
    const payload = {
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 1,
      checklist: {
        equipmentConditionPassed: true,
        safetyChecksPassed: true,
        functionalCheckPassed: true,
      },
      notes: "",
    };
    // Elena's original version still submits after her assignment changes.
    const submitted = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/inspections",
      headers,
      payload,
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().workOrder.status).toBe("awaiting_review");
    const reviewed = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/review",
      headers,
      payload: {
        inspectionId: submitted.json().inspection.id,
        expectedWorkOrderVersion: 2,
        idempotencyKey: randomUUID(),
        outcome: "complete",
        notes: "",
      },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().workOrder.status).toBe("completed");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/work-orders",
      headers: { cookie: f.cookie, origin: config.baseUrl },
      payload: {},
    });
    expect(invalid.statusCode).toBe(403);
    expect(invalid.headers["x-authorization-decision"]).toBeUndefined();
    const conflict = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/reassignment",
      headers,
      payload: { technicianId: "user-elena", expectedAssignmentEpoch: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.headers["x-authorization-decision"]).toBe("FAKE ALLOW");
  });
  it("returns a bounded error for unsupported paths", async () => {
    const fixtureValue = fixture(allowAll());
    const app = await fixtureValue.app;
    applications.push(app);
    const response = await app.inject({ method: "GET", url: "/unsupported" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("authorizes each bounded list candidate before returning it", async () => {
    const seen: AuthorizationRequest[] = [];
    const fixtureValue = fixture({
      ...allowAll(seen),
      async authorize(request) {
        seen.push(request);
        return request.resourceId === "wo-pump-17";
      },
    });
    const app = await fixtureValue.app;
    applications.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/work-orders",
      headers: { cookie: fixtureValue.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      createAllowed: false,
      nextOffset: null,
      workOrders: [expect.objectContaining({ id: "wo-pump-17" })],
    });
    expect(seen).toHaveLength(7);
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: capabilities.create,
          resourceId: "work-orders",
        }),
        expect.objectContaining({
          capability: capabilities.read,
          resourceId: "wo-generator-04",
        }),
        expect.objectContaining({
          capability: capabilities.read,
          resourceId: "wo-pump-17",
        }),
      ]),
    );
  });

  it("pages through bounded candidates even when a page has no allowed records", async () => {
    const seen: AuthorizationRequest[] = [];
    const f = fixture({
      ...allowAll(seen),
      async authorize(request) {
        seen.push(request);
        return request.resourceId === "wo-ventilation-03";
      },
    });
    // Generated hexadecimal IDs sort before the seeded ventilation order.
    for (let index = 0; index < 21; index += 1) {
      const order = f.database.createWorkOrder({
        equipment: `Test fan ${index}`,
        site: "Test bay",
        technicianId: "user-elena",
      });
      expect(order).toBeDefined();
    }
    const app = await f.app;
    applications.push(app);
    const first = await app.inject({
      url: "/api/work-orders",
      headers: { cookie: f.cookie },
    });
    expect(first.json()).toEqual({
      workOrders: [],
      createAllowed: false,
      nextOffset: 20,
    });
    expect(
      seen.filter((request) => request.capability === capabilities.read),
    ).toHaveLength(20);
    seen.length = 0;
    const second = await app.inject({
      url: "/api/work-orders?offset=20",
      headers: { cookie: f.cookie },
    });
    expect(second.json()).toEqual({
      workOrders: [expect.objectContaining({ id: "wo-ventilation-03" })],
      createAllowed: false,
      nextOffset: null,
    });
    expect(
      seen.filter((request) => request.capability === capabilities.read),
    ).toHaveLength(7);
    const empty = await app.inject({
      url: "/api/work-orders?offset=100",
      headers: { cookie: f.cookie },
    });
    expect(empty.json()).toEqual({
      workOrders: [],
      createAllowed: false,
      nextOffset: null,
    });
  });

  it("rejects malformed offsets before authorizing or loading candidates", async () => {
    const seen: AuthorizationRequest[] = [];
    const f = fixture(allowAll(seen));
    const app = await f.app;
    applications.push(app);
    for (const query of [
      "offset=-1",
      "offset=1.5",
      "offset=",
      "offset=abc",
      "offset=1e2",
      "offset=9007199254740991",
      "offset=0&offset=20",
    ]) {
      const response = await app.inject({
        url: `/api/work-orders?${query}`,
        headers: { cookie: f.cookie },
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error).toBe("invalid_offset");
    }
    expect(seen).toHaveLength(0);
  });

  it("marks authenticated endpoints and errors private and non-cacheable", async () => {
    const f = fixture(allowAll());
    const app = await f.app;
    applications.push(app);
    for (const url of [
      "/api/session",
      "/api/work-orders",
      "/api/work-orders/wo-pump-17",
      "/api/work-orders/missing",
      "/api/work-orders?offset=-1",
      "/auth/login?login_hint=elena",
      "/auth/callback",
    ]) {
      const response = await app.inject({ url, headers: { cookie: f.cookie } });
      expect(response.headers["cache-control"], url).toBe("private, no-store");
    }
    const unauthenticated = await app.inject({ url: "/api/session" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers["cache-control"]).toBe("private, no-store");
    const invalidOrigin = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: f.cookie },
    });
    expect(invalidOrigin.statusCode).toBe(403);
    expect(invalidOrigin.headers["cache-control"]).toBe("private, no-store");
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        cookie: f.cookie,
        origin: config.baseUrl,
        "x-csrf-token": f.csrf,
      },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["cache-control"]).toBe("private, no-store");
    expect(
      (await app.inject({ url: "/healthz" })).headers["cache-control"],
    ).toBeUndefined();
  });

  it("authorizes bounded creation and conditional deletion", async () => {
    const seen: AuthorizationRequest[] = [];
    const fixtureValue = fixture(allowAll(seen));
    const app = await fixtureValue.app;
    applications.push(app);
    const headers = {
      cookie: fixtureValue.cookie,
      origin: config.baseUrl,
      "x-csrf-token": fixtureValue.csrf,
    };
    const creation = await app.inject({
      method: "POST",
      url: "/api/work-orders",
      headers,
      payload: {
        equipment: "Hydraulic press 05",
        site: "Machine Hall",
        technicianId: "user-malik",
      },
    });
    expect(creation.statusCode).toBe(201);
    const created = creation.json().workOrder;
    expect(created).toMatchObject({
      equipment: "Hydraulic press 05",
      assigneeId: "user-malik",
      status: "open",
    });

    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/work-orders/${created.id}`,
      headers,
      payload: {
        expectedAssignmentEpoch: 1,
        expectedWorkOrderVersion: 1,
      },
    });
    expect(deletion.statusCode).toBe(204);
    expect(fixtureValue.database.findWorkOrder(created.id)).toBeUndefined();
    expect(seen).toEqual([
      expect.objectContaining({ capability: capabilities.create }),
      expect.objectContaining({ capability: capabilities.delete }),
    ]);
  });

  it("performs no create or delete effect after an authorization denial", async () => {
    const fixtureValue = fixture({
      ...allowAll(),
      async authorize(request) {
        return ![capabilities.create, capabilities.delete].includes(
          request.capability,
        );
      },
    });
    const app = await fixtureValue.app;
    applications.push(app);
    const headers = {
      cookie: fixtureValue.cookie,
      origin: config.baseUrl,
      "x-csrf-token": fixtureValue.csrf,
    };
    const creation = await app.inject({
      method: "POST",
      url: "/api/work-orders",
      headers,
      payload: {
        equipment: "Hydraulic press 05",
        site: "Machine Hall",
        technicianId: "user-malik",
      },
    });
    const deletion = await app.inject({
      method: "DELETE",
      url: "/api/work-orders/wo-pump-17",
      headers,
      payload: {
        expectedAssignmentEpoch: 1,
        expectedWorkOrderVersion: 1,
      },
    });
    expect(creation.statusCode).toBe(403);
    expect(deletion.statusCode).toBe(403);
    expect(fixtureValue.database.listWorkOrders()).toHaveLength(6);
    expect(fixtureValue.database.findWorkOrder("wo-pump-17")).toBeDefined();
  });

  it("keeps origin and CSRF checks outside the authorization adapter", async () => {
    const fixtureValue = fixture(allowAll());
    const app = await fixtureValue.app;
    applications.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/reassignment",
      headers: { cookie: fixtureValue.cookie },
      payload: { expectedAssignmentEpoch: 1, technicianId: "user-malik" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "invalid_origin" });
    expect(fixtureValue.database.findWorkOrder("wo-pump-17")).toMatchObject({
      assigneeId: "user-elena",
      assignmentEpoch: 1,
    });
  });

  it("reproduces the stale-assignment gap while preserving transactional checks", async () => {
    const fixtureValue = fixture(allowAll());
    const app = await fixtureValue.app;
    applications.push(app);
    const headers = {
      cookie: fixtureValue.cookie,
      origin: config.baseUrl,
      "x-csrf-token": fixtureValue.csrf,
    };
    const reassignment = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/reassignment",
      headers,
      payload: { expectedAssignmentEpoch: 1, technicianId: "user-malik" },
    });
    expect(reassignment.statusCode).toBe(200);

    const submission = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/inspections",
      headers,
      payload: {
        idempotencyKey: randomUUID(),
        expectedWorkOrderVersion: 1,
        checklist: {
          equipmentConditionPassed: true,
          safetyChecksPassed: true,
          functionalCheckPassed: true,
        },
        notes: "Queued before reassignment.",
      },
    });
    expect(submission.statusCode).toBe(200);
    expect(submission.json()).toMatchObject({
      replayed: false,
      workOrder: {
        assigneeId: "user-malik",
        assignmentEpoch: 2,
        status: "awaiting_review",
      },
    });
    expect(fixtureValue.database.inspectionCount()).toBe(1);
  });

  it("authorizes review independently and returns inspection evidence on detail", async () => {
    const seen: AuthorizationRequest[] = [];
    let denyReview = true;
    const fixtureValue = fixture({
      ...allowAll(seen),
      async authorize(request) {
        seen.push(request);
        return !(denyReview && request.capability === capabilities.review);
      },
    });
    const app = await fixtureValue.app;
    applications.push(app);
    const headers = {
      cookie: fixtureValue.cookie,
      origin: config.baseUrl,
      "x-csrf-token": fixtureValue.csrf,
    };
    const submission = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/inspections",
      headers,
      payload: {
        idempotencyKey: randomUUID(),
        expectedWorkOrderVersion: 1,
        checklist: {
          equipmentConditionPassed: true,
          safetyChecksPassed: true,
          functionalCheckPassed: true,
        },
        notes: "All checks passed.",
      },
    });
    const payload = {
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 2,
      inspectionId: submission.json().inspection.id,
      outcome: "complete",
      notes: "Reviewed.",
    };
    const denied = await app.inject({
      method: "POST",
      url: "/api/work-orders/wo-pump-17/review",
      headers,
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(fixtureValue.database.findWorkOrder("wo-pump-17")?.status).toBe(
      "awaiting_review",
    );
    denyReview = false;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/work-orders/wo-pump-17/review",
          headers,
          payload,
        })
      ).json().workOrder.status,
    ).toBe("completed");
    const detail = await app.inject({
      method: "GET",
      url: "/api/work-orders/wo-pump-17",
      headers,
    });
    expect(detail.json().inspections[0]).toMatchObject({
      notes: "All checks passed.",
      review: { notes: "Reviewed.", outcome: "complete" },
    });
    expect(
      seen.some((request) => request.capability === capabilities.review),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/work-orders/wo-pump-17/review",
          headers,
          payload: { ...payload, actorId: "user-rowan" },
        })
      ).statusCode,
    ).toBe(400);
  });
});
