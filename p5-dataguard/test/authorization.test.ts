/** Validate policy boundaries and SDK failure behavior with actual Cedar archives. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  createDataAuthorization,
  type DataAuthorization,
} from "../src/server/authorization.ts";
import type { AggregatePlan, Analyst } from "../src/shared/contracts.ts";

let authorization: DataAuthorization;
beforeAll(async () => {
  authorization = await createDataAuthorization();
});
afterAll(async () => {
  await authorization?.close();
});
const theo: Analyst = {
  id: "analyst-theo",
  name: "Theo",
  role: "External reviewer",
  tenantId: "tenant-b",
};
const audit: AggregatePlan = {
  kind: "aggregate",
  operation: "count",
  purpose: "external-audit",
  filter: { field: "tenantId", operator: "eq", value: "tenant-b" },
  limit: 50,
};
const evaluate = (
  plan: AggregatePlan,
  minimumGroupSize?: number,
  analyst = theo,
) =>
  authorization.authorize({
    requestId: "policy-test",
    capability: "data.aggregate",
    analyst,
    plan,
    ...(minimumGroupSize !== undefined ? { minimumGroupSize } : {}),
  });

describe("P5 policy rules", () => {
  test("logs correlated native decisions for fields and plans without input values", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const failure = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await authorization.inspect("inspect-proof", theo);
      await evaluate(audit, 8);
      await evaluate(audit, 4);
      await expect(evaluate(audit, Number.NaN)).rejects.toMatchObject({
        status: 503,
      });
      const logs = info.mock.calls.map(([value]) => JSON.parse(String(value)));
      const contexts = logs.filter(
        (entry) => entry.event === "authorization.context",
      );
      expect(
        contexts.filter((entry) => entry.capability === "dataset.inspect"),
      ).toHaveLength(10);
      for (const context of contexts) {
        expect(context).toMatchObject({
          actorId: theo.id,
          phase: "enforcement",
        });
        expect(
          logs.find(
            (entry) =>
              entry.request_id === context.cedarlingRequestId &&
              entry.log_kind === "Decision",
          ),
        ).toBeDefined();
      }
      expect(logs).toContainEqual(
        expect.objectContaining({
          decision: "ALLOW",
          diagnostics: expect.objectContaining({
            reason: expect.arrayContaining([
              expect.objectContaining({ id: "authorized-plan" }),
            ]),
            errors: [],
          }),
        }),
      );
      expect(logs).toContainEqual(
        expect.objectContaining({
          decision: "DENY",
          diagnostics: { reason: [], errors: [] },
        }),
      );
      expect(JSON.parse(String(failure.mock.calls[0]?.[0]))).toMatchObject({
        event: "authorization.failed",
        category: "authorization_unavailable",
        requestId: "policy-test",
      });
      expect(JSON.stringify(logs)).not.toContain("minimum_group_size");
      expect(JSON.stringify(logs)).not.toContain("accessToken");
    } finally {
      info.mockRestore();
      failure.mockRestore();
    }
  });
  test.each([
    [0, false],
    [4, false],
    [5, true],
    [6, true],
  ] as const)("group size %i yields %s", async (size, allowed) => {
    expect(await evaluate(audit, size)).toBe(allowed);
  });
  test("missing cardinality fails closed", async () => {
    expect(await evaluate(audit)).toBe(false);
  });
  test("field restrictions apply even when cardinality alone would allow", async () => {
    for (const groupBy of [
      "employeeId",
      "fullName",
      "workEmail",
      "salary",
      "bonus",
    ] as const)
      expect(await evaluate({ ...audit, groupBy }, 6)).toBe(false);
    expect(
      await evaluate({ ...audit, operation: "average", field: "salary" }, 6),
    ).toBe(false);
  });
  test("unknown roles have no permissions", async () => {
    const analyst = { ...theo, role: "Unknown" };
    expect(await authorization.inspect("unknown", analyst)).toEqual([]);
    expect(await evaluate(audit, 6, analyst)).toBe(false);
  });
  test("invalid request facts become unavailable rather than an allow", async () => {
    await expect(evaluate(audit, Number.NaN)).rejects.toMatchObject({
      status: 503,
      code: "authorization_unavailable",
    });
  });
  test("missing or malformed archives cannot initialize", async () => {
    const directory = await mkdtemp(join(tmpdir(), "p5-invalid-policy-"));
    try {
      await expect(
        createDataAuthorization(join(directory, "missing.cjar")),
      ).rejects.toThrow();
      const archive = join(directory, "invalid.cjar");
      await writeFile(archive, "not an archive");
      await expect(createDataAuthorization(archive)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("a field-batch schema error fails the whole inspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "p5-field-policy-"));
    let changed: DataAuthorization | undefined;
    try {
      const entries = unzipSync(
        new Uint8Array(await readFile(".local/policy-store.cjar")),
      );
      const schema = entries["schema.cedarschema"];
      if (!schema) throw new Error("Missing schema");
      entries["schema.cedarschema"] = strToU8(
        strFromU8(schema).replace(
          "entity Field = { name: String, classification: String };",
          "entity Field = { name: String, classification: String, required_marker: String };",
        ),
      );
      const archive = join(directory, "fields.cjar");
      await writeFile(archive, zipSync(entries));
      changed = await createDataAuthorization(archive);
      await expect(changed.inspect("field-error", theo)).rejects.toMatchObject({
        status: 503,
      });
    } finally {
      await changed?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
