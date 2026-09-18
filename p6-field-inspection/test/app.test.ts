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
import type { Config } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { type Capability, capabilities } from "../src/shared/capabilities.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];
const applications: FastifyInstance[] = [];
const config: Config = {
  host: "127.0.0.1",
  port: 3006,
  baseUrl: "http://p6.localhost:3006",
  issuer: "http://idp.localhost:4000",
  apiResource: "http://p6.localhost:3006/api",
  clientId: "p6-field-inspection",
  clientSecret: "s".repeat(43),
  dataDirectory: resolve(".local/test-data"),
};
const oidc: OidcRuntime = {
  authorizationUrl: async () => new URL("http://idp.localhost:4000/auth"),
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
          safetyGuardSecured: true,
          fluidLevelChecked: true,
          operatingTemperatureRecorded: true,
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
        status: "completed",
      },
    });
    expect(fixtureValue.database.inspectionCount()).toBe(1);
  });
});
