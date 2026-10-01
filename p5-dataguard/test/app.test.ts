/** Exercise the real policy store at the HTTP boundary and verify protected effects. */

import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { digestJson } from "../src/server/crypto.ts";
import { AppDatabase } from "../src/server/database.ts";
import { AuthorizationError } from "../src/server/errors.ts";
import type { ExportCreated, QueryPlan } from "../src/shared/contracts.ts";
import { createHarness, type Harness } from "./harness.ts";

vi.mock("node:fs", { spy: true });

const support: QueryPlan = {
  kind: "rows",
  fields: ["employeeId", "department", "tenantId"],
  filter: { field: "tenantId", operator: "eq", value: "tenant-a" },
  purpose: "support",
  limit: 50,
};
const finance: QueryPlan = {
  ...support,
  fields: [
    "employeeId",
    "fullName",
    "workEmail",
    "salary",
    "bonus",
    "tenantId",
  ],
  purpose: "finance-review",
};
const audit: QueryPlan = {
  kind: "aggregate",
  operation: "count",
  purpose: "external-audit",
  filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
  limit: 50,
};

describe("P5 authorized API", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h?.close();
    vi.restoreAllMocks();
  });

  async function query(persona: "amina" | "leah" | "theo", plan: QueryPlan) {
    return h.app.request(
      `/api/query/${plan.kind === "rows" ? "rows" : "aggregate"}`,
      h.mutation(h.session(persona), plan),
    );
  }
  async function create(plan: QueryPlan = finance): Promise<ExportCreated> {
    const response = await h.app.request(
      "/api/exports",
      h.mutation(h.session("leah"), plan),
    );
    expect(response.status).toBe(201);
    return response.json() as Promise<ExportCreated>;
  }

  test("returns only independently authorized metadata, without a global count", async () => {
    for (const [persona, expected] of [
      [
        "amina",
        [
          "employeeId",
          "department",
          "location",
          "supportTier",
          "employmentStatus",
          "tenantId",
        ],
      ],
      [
        "leah",
        [
          "employeeId",
          "fullName",
          "workEmail",
          "department",
          "location",
          "supportTier",
          "employmentStatus",
          "salary",
          "bonus",
          "tenantId",
        ],
      ],
      [
        "theo",
        [
          "department",
          "location",
          "supportTier",
          "employmentStatus",
          "tenantId",
        ],
      ],
    ] as const) {
      const response = await h.app.request("/api/dataset", {
        headers: { cookie: h.session(persona).cookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        dataset: { fields: { name: string }[] };
      };
      expect(body.dataset.fields.map((field) => field.name)).toEqual(expected);
      expect(body.dataset).not.toHaveProperty("recordCount");
    }
  });

  test("logs committed effects and bounded failures without tokens, references, or results", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const session = h.session("leah");
    const rows = await h.app.request(
      "/api/query/rows",
      h.mutation(session, finance),
    );
    expect(rows.status).toBe(200);
    const created = await create();
    const download = await h.app.request(
      "/api/exports/download",
      h.mutation(session, { downloadRef: created.downloadRef }),
    );
    expect(download.status).toBe(200);
    const revoked = await h.app.request(
      `/api/exports/${created.export.id}/revoke`,
      h.mutation(session),
    );
    expect(revoked.status).toBe(200);
    vi.spyOn(h.database, "execute").mockImplementationOnce(() => {
      throw new Error("private-database-path");
    });
    const failed = await h.app.request(
      "/api/query/rows",
      h.mutation(session, finance),
    );
    expect(failed.status).toBe(503);
    const logs = info.mock.calls.map(([value]) => JSON.parse(String(value)));
    const requestId = failed.headers.get("x-request-id");
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: "request.failed",
        requestId,
        category: "database_unavailable",
        httpStatus: 503,
      }),
    );
    expect(
      logs.filter(
        (entry) =>
          entry.requestId === requestId &&
          entry.event === "data.query.completed",
      ),
    ).toEqual([]);
    for (const event of [
      "data.query.completed",
      "export.created",
      "export.download.prepared",
      "export.revoked",
    ]) {
      expect(logs).toContainEqual(
        expect.objectContaining({
          event,
          actorId: "analyst-leah",
          requestId: expect.any(String),
        }),
      );
    }
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: "export.download.prepared",
        requestId: download.headers.get("x-request-id"),
      }),
    );
    const serialized = JSON.stringify(logs);
    for (const privateValue of [
      session.cookie,
      session.csrf,
      created.downloadRef,
      "access-leah",
      "private-database-path",
      "nia@tenant-a.test",
    ])
      expect(serialized).not.toContain(privateValue);
  });

  test("permits support rows, finance rows, and external aggregate evidence", async () => {
    for (const [persona, plan, count] of [
      ["amina", support, 10],
      ["leah", finance, 10],
      ["theo", audit, 1],
    ] as const) {
      const response = await query(persona, plan);
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { rows: unknown[] }).rows,
      ).toHaveLength(count);
    }
  });

  test("previews exact plans without executing protected SQL or creating exports", async () => {
    const execute = vi.spyOn(h.database, "execute");
    const create = vi.spyOn(h.exports, "create");
    for (const [persona, plan, canQuery, canExport] of [
      ["amina", support, true, false],
      ["leah", finance, true, true],
      ["theo", audit, true, false],
      ["theo", { ...support, purpose: "external-audit" }, false, false],
    ] as const) {
      const response = await h.app.request(
        "/api/authorization",
        h.mutation(h.session(persona), { queryPlan: plan, exportPlan: plan }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        query: canQuery,
        createExport: canExport,
        download: false,
        revoke: false,
      });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("binds export guidance to the completed plan and checks aggregate thresholds", async () => {
    const response = await h.app.request(
      "/api/authorization",
      h.mutation(h.session("leah"), {
        queryPlan: support,
        exportPlan: finance,
      }),
    );
    expect(await response.json()).toMatchObject({
      query: false,
      createExport: true,
    });
    const aggregate = await h.app.request(
      "/api/authorization",
      h.mutation(h.session("theo"), {
        queryPlan: { ...audit, groupBy: "department" },
      }),
    );
    expect(await aggregate.json()).toMatchObject({ query: false });
  });

  test("previews export ownership and expiry without changing export metadata", async () => {
    const created = await create();
    const preview = (persona: "leah" | "amina") =>
      h.app.request(
        "/api/authorization",
        h.mutation(h.session(persona), {
          queryPlan: finance,
          exportId: created.export.id,
        }),
      );
    expect(await (await preview("leah")).json()).toMatchObject({
      download: true,
      revoke: true,
    });
    expect(await (await preview("amina")).json()).toMatchObject({
      download: false,
      revoke: false,
    });
    h.sql
      .prepare("UPDATE exports SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, created.export.id);
    const before = h.sql
      .prepare("SELECT * FROM exports WHERE id = ?")
      .get(created.export.id);
    expect(await (await preview("leah")).json()).toMatchObject({
      download: false,
      revoke: false,
    });
    expect(
      h.sql
        .prepare("SELECT * FROM exports WHERE id = ?")
        .get(created.export.id),
    ).toEqual(before);
  });

  test("requires authentic bounded preview requests and fails closed on engine failure", async () => {
    const authorize = vi.spyOn(h.authorization, "authorize");
    const request = h.mutation(h.session("amina"), { queryPlan: support });
    expect(
      (await h.app.request("/api/authorization", { method: "POST" })).status,
    ).toBe(401);
    const headers = new Headers(request.headers);
    headers.delete("x-csrf-token");
    expect(
      (await h.app.request("/api/authorization", { ...request, headers }))
        .status,
    ).toBe(403);
    expect(
      (
        await h.app.request(
          "/api/authorization",
          h.mutation(h.session("amina"), {
            queryPlan: { ...support, limit: 100000 },
          }),
        )
      ).status,
    ).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockRejectedValue(
      new AuthorizationError(503, "authorization_unavailable"),
    );
    const response = await h.app.request("/api/authorization", request);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "authorization_unavailable",
    });
  });

  test("does not evaluate an already cancelled request", async () => {
    const control = new AbortController();
    control.abort();
    const authorize = vi.spyOn(h.authorization, "authorize");
    const execute = vi.spyOn(h.database, "execute");
    const response = await h.app.request(
      new Request(`${h.config.baseUrl}/api/query/rows`, {
        ...h.mutation(h.session("amina"), support),
        signal: control.signal,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "request_cancelled" });
    expect(authorize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([
    { ...support, fields: ["salary"] },
    { ...support, fields: ["fullName"] },
    { ...support, filter: undefined },
    {
      ...support,
      filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
    },
    {
      ...support,
      filter: { field: "tenantId", operator: "contains", value: "tenant-a" },
    },
    { ...support, purpose: "finance-review" },
    { ...support, filter: { field: "salary", operator: "gte", value: 1 } },
  ] as QueryPlan[])(
    "denies invalid support intent before protected SQL: %j",
    async (plan) => {
      const execute = vi.spyOn(h.database, "execute");
      const response = await query("amina", plan);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "authorization_denied",
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test("denies external row access, identifying groups, and compensation operands", async () => {
    for (const plan of [
      { ...support, purpose: "external-audit", filter: audit.filter },
      { ...audit, groupBy: "employeeId" },
      { ...audit, operation: "average", field: "salary" },
    ] as QueryPlan[])
      expect((await query("theo", plan)).status).toBe(403);
  });

  test("enforces five per released group, not total matching records", async () => {
    expect(
      (await query("theo", { ...audit, groupBy: "department" })).status,
    ).toBe(403);
    const five = await query("theo", {
      ...audit,
      groupBy: "department",
      limit: 1,
    });
    expect(five.status).toBe(200);
    expect(((await five.json()) as { rows: unknown[] }).rows).toEqual([
      { department: "Finance", count: 5 },
    ]);
    expect(
      (
        await query("amina", {
          ...audit,
          purpose: "support",
          filter: support.filter,
          groupBy: "employmentStatus",
          limit: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await query("leah", {
          ...audit,
          purpose: "finance-review",
          filter: support.filter,
          groupBy: "department",
        })
      ).status,
    ).toBe(403);
    h.sql.prepare("DELETE FROM workforce WHERE tenant_id = ?").run("tenant-b");
    expect((await query("theo", audit)).status).toBe(403);
  });

  test("requires authentication, exact origin, Fetch Metadata, and CSRF for otherwise allowed work", async () => {
    expect((await h.app.request("/api/dataset")).status).toBe(401);
    const session = h.session("amina");
    for (const [name, value] of [
      ["origin", "http://attacker.test"],
      ["origin", "null"],
      ["sec-fetch-site", "cross-site"],
      ["x-csrf-token", ""],
      ["x-csrf-token", "wrong"],
    ] as const) {
      const request = h.mutation(session, support);
      const headers = new Headers(request.headers);
      headers.set(name, value);
      const response = await h.app.request("/api/query/rows", {
        ...request,
        headers,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "request_verification_failed",
      });
    }
    expect((await query("amina", support)).status).toBe(200);
  });

  test("rejects unsupported media, malformed plans and oversized bodies before authorization", async () => {
    const authorize = vi.spyOn(h.authorization, "authorize");
    const request = h.mutation(h.session("amina"), support);
    const headers = new Headers(request.headers);
    headers.set("content-type", "text/plain");
    expect(
      (await h.app.request("/api/query/rows", { ...request, headers })).status,
    ).toBe(415);
    expect(
      (await h.app.request("/api/query/rows", { ...request, body: "{" }))
        .status,
    ).toBe(400);
    expect(
      (
        await h.app.request("/api/query/rows", {
          ...request,
          body: JSON.stringify({ ...support, sql: "SELECT * FROM workforce" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.app.request("/api/query/rows", {
          ...request,
          body: "x".repeat(17_000),
        })
      ).status,
    ).toBe(413);
    expect(authorize).not.toHaveBeenCalled();
  });

  test("retains OIDC HttpOnly cookies and invalidates a logged-out session", async () => {
    const login = await h.app.request("/auth/login?login_hint=amina");
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie.toLowerCase()).toContain("path=/auth/callback");
    const callback = await h.app.request(
      "http://localhost:17005/auth/callback?code=test",
      { headers: { cookie: cookie.split(";")[0] ?? "" } },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("set-cookie")?.toLowerCase()).toContain(
      "httponly",
    );
    const session = h.session("amina");
    expect(
      (await h.app.request("/auth/logout", h.mutation(session))).status,
    ).toBe(204);
    expect(
      (
        await h.app.request("/api/dataset", {
          headers: { cookie: session.cookie },
        })
      ).status,
    ).toBe(401);
  });

  test("denies unauthorized export creation without files or metadata", async () => {
    const materialize = vi.spyOn(h.exports, "create");
    for (const persona of ["amina", "theo"] as const) {
      expect(
        (
          await h.app.request(
            "/api/exports",
            h.mutation(h.session(persona), finance),
          )
        ).status,
      ).toBe(403);
    }
    expect(materialize).not.toHaveBeenCalled();
    expect(readdirSync(h.database.exportDirectory)).toEqual([]);
    expect(
      h.sql.prepare("SELECT count(*) AS count FROM exports").get(),
    ).toEqual({ count: 0 });
  });

  test("allows Leah's export lifecycle and denies cross-owner effects", async () => {
    const created = await create();
    expect(created.export.ownerId).toBe("analyst-leah");
    for (const persona of ["amina", "theo"] as const) {
      const session = h.session(persona);
      expect(
        (
          await h.app.request(
            "/api/exports/download",
            h.mutation(session, { downloadRef: created.downloadRef }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await h.app.request(
            `/api/exports/${created.export.id}/revoke`,
            h.mutation(session),
          )
        ).status,
      ).toBe(403);
      expect(h.database.getExportById(created.export.id)?.state).toBe("ready");
    }
    const leah = h.session("leah");
    const download = await h.app.request(
      "/api/exports/download",
      h.mutation(leah, { downloadRef: created.downloadRef }),
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toContain(
      "employeeId,fullName,workEmail,salary,bonus,tenantId",
    );
    for (let index = 0; index < 2; index++) {
      const revoke = await h.app.request(
        `/api/exports/${created.export.id}/revoke`,
        h.mutation(leah),
      );
      expect(revoke.status).toBe(200);
      expect(await revoke.json()).toMatchObject({
        export: { state: "revoked" },
      });
    }
    expect(
      (
        await h.app.request(
          "/api/exports/download",
          h.mutation(leah, { downloadRef: created.downloadRef }),
        )
      ).status,
    ).toBe(410);
    expect(readdirSync(h.database.exportDirectory)).toEqual([]);
  });

  test("denies another finance analyst access to Leah's export", async () => {
    const created = await create();
    h.sql
      .prepare("UPDATE analysts SET role = 'Finance lead' WHERE id = ?")
      .run("analyst-amina");
    const amina = h.session("amina");
    expect((await query("amina", finance)).status).toBe(200);
    for (const [url, body] of [
      ["/api/exports/download", { downloadRef: created.downloadRef }],
      [`/api/exports/${created.export.id}/revoke`, undefined],
    ] as const) {
      expect((await h.app.request(url, h.mutation(amina, body))).status).toBe(
        403,
      );
    }
    expect(h.database.getExportById(created.export.id)?.state).toBe("ready");
    expect(readdirSync(h.database.exportDirectory)).toHaveLength(1);
  });

  test("keeps the ready CSV when the revoke transaction cannot commit", async () => {
    const created = await create();
    const file = h.database.getExportById(created.export.id)?.filePath;
    if (!file) throw new Error("Missing ready export");
    // A deferred constraint fails at COMMIT, after the lifecycle method returns.
    h.sql.exec(`
      CREATE TABLE deferred_export (export_id TEXT REFERENCES exports(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_revoke AFTER UPDATE OF state ON exports WHEN NEW.state = 'revoked'
      BEGIN INSERT INTO deferred_export VALUES ('missing-export'); END;
    `);
    const response = await h.app.request(
      `/api/exports/${created.export.id}/revoke`,
      h.mutation(h.session("leah")),
    );
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(h.database.getExportById(created.export.id)?.state).toBe("ready");
    expect(existsSync(file)).toBe(true);
  });

  test("keeps revocation committed when unlink fails and retries cleanup", async () => {
    const created = await create();
    const file = h.database.getExportById(created.export.id)?.filePath;
    if (!file) throw new Error("Missing ready export");
    const remove = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("controlled unlink failure");
    });
    const leah = h.session("leah");
    const response = await h.app.request(
      `/api/exports/${created.export.id}/revoke`,
      h.mutation(leah),
    );
    expect(response.status).toBe(200);
    expect(h.database.getExportById(created.export.id)?.state).toBe("revoked");
    expect(existsSync(file)).toBe(true);
    remove.mockRestore();
    expect(
      (
        await h.app.request(
          "/api/exports/download",
          h.mutation(leah, { downloadRef: created.downloadRef }),
        )
      ).status,
    ).toBe(410);
    expect(existsSync(file)).toBe(false);
  });

  test.each([
    "inspect",
    "rows",
    "aggregate",
    "create",
    "revoke",
    "download",
  ] as const)(
    "cancellation during %s authorization prevents its protected effect",
    async (operation) => {
      const created = await create();
      const control = new AbortController();
      const original = h.authorization.authorize;
      const inspect = h.authorization.inspect;
      h.authorization.authorize = async (request) => {
        const result = await original(request);
        control.abort();
        return result;
      };
      h.authorization.inspect = async (...args) => {
        const result = await inspect(...args);
        control.abort();
        return result;
      };
      const execute = vi.spyOn(h.database, "execute");
      const read = vi.spyOn(h.exports, "read");
      const leah = h.session("leah");
      const requests = {
        inspect: ["/api/dataset", { headers: { cookie: leah.cookie } }],
        rows: ["/api/query/rows", h.mutation(leah, finance)],
        aggregate: [
          "/api/query/aggregate",
          h.mutation(leah, {
            ...audit,
            filter: support.filter,
            purpose: "finance-review",
          }),
        ],
        create: ["/api/exports", h.mutation(leah, finance)],
        revoke: [`/api/exports/${created.export.id}/revoke`, h.mutation(leah)],
        download: [
          "/api/exports/download",
          h.mutation(leah, { downloadRef: created.downloadRef }),
        ],
      } satisfies Record<typeof operation, [string, RequestInit]>;
      const [url, init] = requests[operation];
      const response = await h.app.request(
        new Request(`${h.config.baseUrl}${url}`, {
          ...init,
          signal: control.signal,
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "request_cancelled",
      });
      expect(execute).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(h.database.getExportById(created.export.id)?.state).toBe("ready");
      expect(readdirSync(h.database.exportDirectory)).toHaveLength(1);
    },
  );

  test("applies the aggregate threshold to finance exports and allows eligible averages", async () => {
    const plan: QueryPlan = {
      ...audit,
      purpose: "finance-review",
      filter: support.filter,
      operation: "average",
      field: "salary",
    };
    const created = await create(plan);
    expect(created.export.rowCount).toBe(1);
    expect(
      (
        await h.app.request(
          "/api/exports",
          h.mutation(h.session("leah"), { ...plan, groupBy: "department" }),
        )
      ).status,
    ).toBe(403);
  });

  test("does not expose internal export metadata and binds the saved plan digest", async () => {
    const created = await create();
    const stored = h.database.getExportByReference(created.downloadRef);
    expect(stored?.planDigest).toBe(digestJson(finance));
    for (const field of ["filePath", "plan", "planDigest", "downloadHash"])
      expect(created.export).not.toHaveProperty(field);
    expect(digestJson({ b: 2, a: 1 })).toBe(digestJson({ a: 1, b: 2 }));
  });

  test("enforces expiry independently of reference possession", async () => {
    const created = await create();
    h.sql
      .prepare("UPDATE exports SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, created.export.id);
    const leah = h.session("leah");
    expect(
      (
        await h.app.request(
          "/api/exports/download",
          h.mutation(leah, { downloadRef: created.downloadRef }),
        )
      ).status,
    ).toBe(410);
    expect(readdirSync(h.database.exportDirectory)).toEqual([]);
  });

  test("rejects changed aggregate facts after Cedarling without executing protected SQL", async () => {
    const original = h.authorization.authorize;
    h.authorization.authorize = async (request) => {
      const allowed = await original(request);
      h.sql
        .prepare(
          "DELETE FROM workforce WHERE tenant_id = ? AND employee_id != ?",
        )
        .run("tenant-b", "B-001");
      return allowed;
    };
    const execute = vi.spyOn(h.database, "execute");
    const response = await query("theo", audit);
    expect(response.status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
  });

  test("rejects changed analyst entitlement after Cedarling", async () => {
    const original = h.authorization.authorize;
    h.authorization.authorize = async (request) => {
      const allowed = await original(request);
      h.sql
        .prepare("UPDATE analysts SET role = 'External reviewer' WHERE id = ?")
        .run("analyst-leah");
      return allowed;
    };
    expect((await query("leah", finance)).status).toBe(409);
  });

  test.each(["revoke", "expire"] as const)(
    "does not read a file when an export changes during authorization: %s",
    async (change) => {
      const created = await create();
      const original = h.authorization.authorize;
      h.authorization.authorize = async (request) => {
        const allowed = await original(request);
        if (change === "revoke") h.database.revokeExport(created.export.id);
        else
          h.sql
            .prepare("UPDATE exports SET expires_at = ? WHERE id = ?")
            .run(Date.now() - 1, created.export.id);
        return allowed;
      };
      const read = vi.spyOn(h.exports, "read");
      expect(
        (
          await h.app.request(
            "/api/exports/download",
            h.mutation(h.session("leah"), { downloadRef: created.downloadRef }),
          )
        ).status,
      ).toBe(409);
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("Cedarling unavailability releases no rows, files, or export state changes", async () => {
    const created = await create();
    h.authorization.authorize = async () => {
      throw new AuthorizationError(503, "authorization_unavailable");
    };
    const execute = vi.spyOn(h.database, "execute");
    const read = vi.spyOn(h.exports, "read");
    for (const [url, body] of [
      ["/api/query/rows", finance],
      ["/api/exports", finance],
      ["/api/exports/download", { downloadRef: created.downloadRef }],
      [`/api/exports/${created.export.id}/revoke`, undefined],
    ] as const) {
      const response = await h.app.request(
        url,
        h.mutation(h.session("leah"), body),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "authorization_unavailable",
      });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(h.database.getExportById(created.export.id)?.state).toBe("ready");
    expect(readdirSync(h.database.exportDirectory)).toHaveLength(1);
  });

  test("fails closed on SQLite failure and removes partial export files", async () => {
    h.sql.exec(
      "CREATE TRIGGER fail_export BEFORE INSERT ON exports BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    expect(
      (
        await h.app.request(
          "/api/exports",
          h.mutation(h.session("leah"), finance),
        )
      ).status,
    ).toBe(503);
    expect(readdirSync(h.database.exportDirectory)).toEqual([]);
    vi.spyOn(h.database, "execute").mockImplementation(() => {
      throw new Error("SQLite unavailable");
    });
    expect((await query("amina", support)).status).toBe(503);
  });

  test("cleanup preserves exports committed by another connection", async () => {
    const created = await create();
    const pending = path.join(
      h.database.exportDirectory,
      "00000000-0000-4000-8000-000000000001.csv",
    );
    const orphan = path.join(
      h.database.exportDirectory,
      "00000000-0000-4000-8000-000000000002.csv",
    );
    writeFileSync(orphan, "orphan");
    h.sql.exec("BEGIN IMMEDIATE");
    try {
      writeFileSync(pending, "pending export");
      h.sql
        .prepare(`INSERT INTO exports
        SELECT 'pending-export', owner_id, purpose, plan_json, 'pending-hash', plan_digest, ?, state, row_count, created_at, expires_at
        FROM exports WHERE id = ?`)
        .run(pending, created.export.id);
      expect(() => h.database.cleanupExports()).toThrow(/locked/);
      expect(existsSync(pending)).toBe(true);
      expect(existsSync(orphan)).toBe(true);
      h.sql.exec("COMMIT");
    } finally {
      if (h.sql.inTransaction) h.sql.exec("ROLLBACK");
    }
    h.database.cleanupExports();
    expect(existsSync(pending)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
    const file = h.database.getExportById(created.export.id)?.filePath;
    expect(file && existsSync(file)).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "cleanup leaves UUID-named symlinks and their targets untouched",
    () => {
      const target = path.join(h.directory, "keep.csv");
      const link = path.join(
        h.database.exportDirectory,
        "00000000-0000-4000-8000-000000000003.csv",
      );
      writeFileSync(target, "unrelated file");
      symlinkSync(target, link);
      h.database.cleanupExports();
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("unrelated file");
    },
  );

  test("reset reports cleanup failure after committing the metadata reset", async () => {
    const created = await create();
    const file = h.database.getExportById(created.export.id)?.filePath;
    if (!file) throw new Error("Missing ready export");
    vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("controlled unlink failure");
    });
    expect(() => h.database.reset(h.config.issuer)).toThrow(
      "controlled unlink failure",
    );
    expect(h.database.getExportById(created.export.id)).toBeUndefined();
    expect(existsSync(file)).toBe(true);
    h.database.cleanupExports();
    expect(existsSync(file)).toBe(false);
  });

  test("resets open connections, export files and sign-ins without deleting unrelated files", async () => {
    const created = await create();
    const amina = h.session("amina");
    h.database.createTransaction({
      rawId: "login",
      state: "state",
      nonce: "nonce",
      verifier: "verifier",
      expiresAt: Date.now() + 60_000,
    });
    const sentinel = path.join(h.directory, "keep.txt");
    writeFileSync(sentinel, "keep");
    const orphan = path.join(
      h.database.exportDirectory,
      "00000000-0000-4000-8000-000000000000.csv",
    );
    writeFileSync(orphan, "orphaned synthetic export");
    writeFileSync(
      path.join(h.database.exportDirectory, "keep.csv"),
      "unrelated CSV",
    );
    mkdirSync(path.join(h.database.exportDirectory, "keep-directory.csv"));
    const archive = readFileSync(".local/policy-store.cjar");
    const resetter = new AppDatabase(
      path.join(h.directory, "p5.sqlite"),
      h.config.issuer,
      h.database.exportDirectory,
    );
    try {
      resetter.reset(h.config.issuer);
    } finally {
      resetter.close();
    }
    expect(h.database.getExportById(created.export.id)).toBeUndefined();
    expect(h.database.consumeTransaction("login")).toBeUndefined();
    expect(
      (
        await h.app.request("/api/dataset", {
          headers: { cookie: amina.cookie },
        })
      ).status,
    ).toBe(401);
    expect(readdirSync(h.database.exportDirectory).sort()).toEqual([
      "keep-directory.csv",
      "keep.csv",
    ]);
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(".local/policy-store.cjar")).toEqual(archive);
    h.sql
      .prepare("UPDATE analysts SET name = ? WHERE id = ?")
      .run("Updated name", "analyst-amina");
    expect(h.database.findAnalyst(h.config.issuer, "amina")?.name).toBe(
      "Updated name",
    );
  });
});
