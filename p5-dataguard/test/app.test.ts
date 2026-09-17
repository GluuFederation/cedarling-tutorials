import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { digestJson } from "../src/server/crypto.ts";
import type { QueryPlan } from "../src/shared/contracts.ts";
import { createHarness, type Harness } from "./harness.ts";

const crossTenantCompensation: QueryPlan = {
  kind: "rows",
  fields: ["employeeId", "salary", "bonus", "tenantId"],
  filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
  purpose: "support",
  limit: 50,
};

const smallGroupAggregate: QueryPlan = {
  kind: "aggregate",
  operation: "count",
  groupBy: "tenantId",
  filter: { field: "department", operator: "eq", value: "People" },
  purpose: "external-audit",
  limit: 50,
};

describe("P5 permissive API", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  test("requires authentication and same-origin CSRF evidence", async () => {
    expect((await harness.app.request("/api/dataset")).status).toBe(401);
    const amina = harness.session("amina");
    const rejected = await harness.app.request("/api/query/rows", {
      ...harness.mutation(amina, crossTenantCompensation),
      headers: {
        cookie: amina.cookie,
        origin: "http://attacker.test",
        "x-csrf-token": amina.csrf,
      },
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({
      error: "request_verification_failed",
    });
  });

  test("rejects unsupported media types before parsing a protected request", async () => {
    const amina = harness.session("amina");
    const response = await harness.app.request("/api/query/rows", {
      method: "POST",
      headers: {
        cookie: amina.cookie,
        origin: harness.config.baseUrl,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": amina.csrf,
        "content-type": "text/plain",
      },
      body: JSON.stringify(crossTenantCompensation),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
  });

  test("keeps the unused export collection out of the HTTP interface", async () => {
    const amina = harness.session("amina");
    const response = await harness.app.request("/api/exports", {
      headers: { cookie: amina.cookie },
    });
    expect(response.status).toBe(404);
  });

  test("sets bounded HttpOnly OIDC transaction and session cookies", async () => {
    const login = await harness.app.request("/auth/login?login_hint=amina");
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toContain("login_hint=amina");
    const transactionCookie = login.headers.get("set-cookie") ?? "";
    expect(transactionCookie).toContain("p5_oidc_transaction=");
    expect(transactionCookie.toLowerCase()).toContain("httponly");
    expect(transactionCookie.toLowerCase()).toContain("samesite=lax");
    expect(transactionCookie.toLowerCase()).toContain("path=/auth/callback");

    const transactionValue = transactionCookie.split(";")[0];
    if (!transactionValue) throw new Error("Missing transaction cookie value");
    const rawTransaction = transactionValue.replace("p5_oidc_transaction=", "");
    const callback = await harness.app.request(
      "http://p5.localhost:3005/auth/callback?code=test",
      { headers: { cookie: `p5_oidc_transaction=${rawTransaction}` } },
    );
    expect(callback.status).toBe(302);
    const sessionCookie = callback.headers.get("set-cookie") ?? "";
    expect(sessionCookie).toContain("p5_session=");
    expect(sessionCookie.toLowerCase()).toContain("httponly");
    expect(sessionCookie.toLowerCase()).toContain("samesite=lax");
    expect(sessionCookie.toLowerCase()).toContain("max-age=1800");
  });

  test("lets Amina read Tenant B compensation at the permissive query seam", async () => {
    const amina = harness.session("amina");
    const response = await harness.app.request(
      "/api/query/rows",
      harness.mutation(amina, crossTenantCompensation),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(body.rows).toHaveLength(8);
    expect(body.rows.every((row) => row.tenantId === "tenant-b")).toBe(true);
    expect(body.rows.every((row) => typeof row.salary === "number")).toBe(true);
  });

  test("lets Theo receive rows and below-boundary aggregate groups", async () => {
    const theo = harness.session("theo");
    const rowResponse = await harness.app.request(
      "/api/query/rows",
      harness.mutation(theo, {
        kind: "rows",
        fields: ["employeeId", "fullName", "workEmail", "tenantId"],
        purpose: "external-audit",
        limit: 4,
      }),
    );
    expect(rowResponse.status).toBe(200);
    expect(
      ((await rowResponse.json()) as { rows: unknown[] }).rows,
    ).toHaveLength(4);

    const aggregateResponse = await harness.app.request(
      "/api/query/aggregate",
      harness.mutation(theo, smallGroupAggregate),
    );
    expect(aggregateResponse.status).toBe(200);
    const aggregate = (await aggregateResponse.json()) as {
      rows: Array<{ tenantId: string; count: number }>;
    };
    expect(aggregate.rows).toEqual([
      { tenantId: "tenant-a", count: 1 },
      { tenantId: "tenant-b", count: 1 },
    ]);
  });

  test("lets Theo export compensation and Amina download it by opaque reference", async () => {
    const theo = harness.session("theo");
    const createdResponse = await harness.app.request(
      "/api/exports",
      harness.mutation(theo, crossTenantCompensation),
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      export: { id: string; ownerId: string; state: string };
      downloadRef: string;
    };
    expect(created.export.ownerId).toBe(theo.analystId);
    expect(created.downloadRef.length).toBeGreaterThanOrEqual(32);
    const amina = harness.session("amina");
    const download = await harness.app.request(
      "/api/exports/download",
      harness.mutation(amina, { downloadRef: created.downloadRef }),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("text/csv");
    expect(await download.text()).toContain("employeeId,salary,bonus,tenantId");
  });

  test("keeps cross-owner revocation at the permissive export seam", async () => {
    const theo = harness.session("theo");
    const createdResponse = await harness.app.request(
      "/api/exports",
      harness.mutation(theo, crossTenantCompensation),
    );
    const created = (await createdResponse.json()) as {
      export: { id: string; ownerId: string };
    };
    const amina = harness.session("amina");
    const status = await harness.app.request(
      `/api/exports/${created.export.id}`,
      { headers: { cookie: amina.cookie } },
    );
    expect(status.status).toBe(404);

    const revoke = await harness.app.request(
      `/api/exports/${created.export.id}/revoke`,
      harness.mutation(amina),
    );
    expect(revoke.status).toBe(200);
    expect(
      ((await revoke.json()) as { export: { state: string } }).export.state,
    ).toBe("revoked");
  });

  test("requires valid CSRF evidence for export creation, revoke, and download", async () => {
    const leah = harness.session("leah");
    for (const [path, body] of [
      ["/api/exports", crossTenantCompensation],
      ["/api/exports/example/revoke", undefined],
      ["/api/exports/download", { downloadRef: "x".repeat(43) }],
    ] as const) {
      const request = harness.mutation(leah, body);
      const headers = new Headers(request.headers);
      headers.set("x-csrf-token", "wrong");
      const response = await harness.app.request(path, {
        ...request,
        headers,
      });
      expect(response.status).toBe(403);
    }
  });

  test("keeps revocation and expiry authoritative", async () => {
    const leah = harness.session("leah");
    const create = async () => {
      const response = await harness.app.request(
        "/api/exports",
        harness.mutation(leah, crossTenantCompensation),
      );
      const value = (await response.json()) as {
        export: { id: string };
        downloadRef: string;
      };
      return value;
    };

    const revoked = await create();
    expect(
      (
        await harness.app.request(
          `/api/exports/${revoked.export.id}/revoke`,
          harness.mutation(leah),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await harness.app.request(
          "/api/exports/download",
          harness.mutation(leah, { downloadRef: revoked.downloadRef }),
        )
      ).status,
    ).toBe(410);

    const expired = await create();
    harness.database.forceExpireExport(expired.export.id);
    const expireThenRevoke = await harness.app.request(
      `/api/exports/${expired.export.id}/revoke`,
      harness.mutation(leah),
    );
    expect(expireThenRevoke.status).toBe(200);
    expect(
      ((await expireThenRevoke.json()) as { export: { state: string } }).export
        .state,
    ).toBe("expired");
    expect(
      (
        await harness.app.request(
          "/api/exports/download",
          harness.mutation(leah, { downloadRef: expired.downloadRef }),
        )
      ).status,
    ).toBe(410);
  });

  test("fails safely when query execution cannot reach SQLite", async () => {
    const amina = harness.session("amina");
    harness.database.evaluate = () => {
      throw new Error("synthetic database failure");
    };
    const response = await harness.app.request(
      "/api/query/rows",
      harness.mutation(amina, crossTenantCompensation),
    );
    expect(response.status).toBe(503);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "database_unavailable",
    });
  });

  test("does not serialize internal export paths, plans, or reference hashes", async () => {
    const leah = harness.session("leah");
    const response = await harness.app.request(
      "/api/exports",
      harness.mutation(leah, crossTenantCompensation),
    );
    const created = (await response.json()) as {
      export: Record<string, unknown>;
    };
    expect(created.export).not.toHaveProperty("filePath");
    expect(created.export).not.toHaveProperty("plan");
    expect(created.export).not.toHaveProperty("planDigest");
    expect(created.export).not.toHaveProperty("downloadHash");
  });

  test("persists a canonical SHA-256 digest for the validated export plan", async () => {
    const leah = harness.session("leah");
    const response = await harness.app.request(
      "/api/exports",
      harness.mutation(leah, crossTenantCompensation),
    );
    const created = (await response.json()) as {
      export: { id: string };
      downloadRef: string;
    };
    const stored = harness.database.getExportByReference(created.downloadRef);
    expect(stored?.id).toBe(created.export.id);
    expect(stored?.planDigest).toBe(digestJson(crossTenantCompensation));
    expect(stored?.planDigest).toHaveLength(64);
    expect(digestJson({ b: 2, a: 1 })).toBe(digestJson({ a: 1, b: 2 }));
  });
});
