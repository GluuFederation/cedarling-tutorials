import { describe, expect, test } from "vitest";
import { workforceFixtures } from "../src/server/fixtures.ts";
import {
  compileCardinalityQuery,
  compileQuery,
  queryPlanSchema,
} from "../src/server/query.ts";

describe("typed query compiler", () => {
  test("keeps the fixture at 18 synthetic records with boundary groups", () => {
    expect(workforceFixtures).toHaveLength(18);
    const groups = new Map<string, number>();
    for (const record of workforceFixtures) {
      const key = `${record[9]}/${record[3]}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    expect([...groups.values()]).toContain(1);
    expect([...groups.values()]).toContain(5);
    expect([...groups.values()]).toContain(6);
  });

  test("uses closed identifiers and binds every request value", () => {
    const plan = queryPlanSchema.parse({
      kind: "rows",
      fields: ["employeeId", "salary", "tenantId"],
      filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
      purpose: "support",
      limit: 8,
    });
    const compiled = compileQuery(plan);
    expect(compiled.sql).toContain('"employee_id" AS "employeeId"');
    expect(compiled.sql).toContain('"tenant_id" = ?');
    expect(compiled.sql).toContain("LIMIT ?");
    expect(compiled.sql).not.toContain("tenant-b");
    expect(compiled.bindings).toEqual(["tenant-b", 8]);
  });

  test("rejects raw SQL, unknown fields, duplicate fields, and malformed filters", () => {
    const attempts = [
      {
        kind: "rows",
        fields: ["employeeId"],
        purpose: "support",
        limit: 10,
        sql: "SELECT * FROM workforce",
      },
      {
        kind: "rows",
        fields: ["password"],
        purpose: "support",
        limit: 10,
      },
      {
        kind: "rows",
        fields: ["employeeId", "employeeId"],
        purpose: "support",
        limit: 10,
      },
      {
        kind: "rows",
        fields: ["employeeId"],
        filter: { field: "salary", operator: "contains", value: 100 },
        purpose: "support",
        limit: 10,
      },
    ];
    for (const attempt of attempts) {
      expect(queryPlanSchema.safeParse(attempt).success).toBe(false);
    }
  });

  test("derives aggregate cardinality from the same validated filter", () => {
    const plan = queryPlanSchema.parse({
      kind: "aggregate",
      operation: "count",
      groupBy: "department",
      filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
      purpose: "external-audit",
      limit: 10,
    });
    if (plan.kind !== "aggregate") throw new Error("Expected aggregate plan");
    const cardinality = compileCardinalityQuery(plan);
    expect(cardinality.sql).toContain('"tenant_id" = ?');
    expect(cardinality.sql).toContain('GROUP BY "department"');
    expect(cardinality.bindings).toEqual(["tenant-b", 10]);
  });
});
