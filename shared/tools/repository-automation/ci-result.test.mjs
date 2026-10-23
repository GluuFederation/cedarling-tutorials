import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { qualityResult } from "./ci-result.mjs";

test("the final workflow result waits for every verification job", async () => {
  const workflow = parse(
    await readFile(
      new URL("../../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    new Set(workflow.jobs.result.needs),
    new Set(Object.keys(workflow.jobs).filter((id) => id !== "result")),
  );
  assert.equal(workflow.jobs.result.if, "always()");
  assert.equal(
    workflow.jobs["compose-concurrency"].if,
    "needs.changes.outputs.concurrent == 'true'",
  );
  assert.equal(
    workflow.jobs.changes.outputs.concurrent,
    `\${{ steps.select.outputs.concurrent }}`,
  );
});

function needs(selected = [], compose = [], helper = false) {
  const concurrent = selected.some((id) =>
    [
      "p1-task-manager",
      "p4-editorial-publishing",
      "p10-warehouse-workloads",
    ].includes(id),
  );
  return {
    changes: {
      result: "success",
      outputs: {
        projects: JSON.stringify(selected),
        compose: JSON.stringify(compose),
        helper: String(helper),
        concurrent: String(concurrent),
      },
    },
    step: { result: helper ? "success" : "skipped" },
    project: { result: selected.length ? "success" : "skipped" },
    "p3-sidecar": {
      result: selected.includes("p3-mcp-capability-governance")
        ? "success"
        : "skipped",
    },
    "compose-config": { result: compose.length ? "success" : "skipped" },
    "compose-concurrency": { result: concurrent ? "success" : "skipped" },
  };
}

test("quality accepts intentional skips and complete selected verification", () => {
  for (const scenario of [
    needs(),
    needs([], [], true),
    needs(["p1-task-manager"], ["p1-task-manager"]),
    needs(
      ["p3-mcp-capability-governance"],
      ["p3-mcp-capability-governance"],
      true,
    ),
  ]) {
    assert.equal(qualityResult(scenario).success, true);
  }
});

test("quality rejects failed selection, malformed outputs, and absent job results", () => {
  assert.throws(() => qualityResult({}), /selection/);
  const scenario = needs();
  scenario.changes.outputs.helper = "";
  assert.throws(() => qualityResult(scenario), /outputs/);
  const missing = needs();
  delete missing.step;
  assert.equal(qualityResult(missing).success, false);
  assert.throws(() => qualityResult(needs(["p1-task-manager"], [])), /outputs/);
  assert.throws(() => qualityResult(needs(["unknown-project"], [])), /outputs/);
});

test("quality rejects missing or inconsistent concurrent-stack selection", () => {
  const required = needs(["p1-task-manager"], ["p1-task-manager"]);
  for (const value of [undefined, "", "false", "TRUE"]) {
    required.changes.outputs.concurrent = value;
    assert.throws(() => qualityResult(required), /outputs/);
  }
  const unrelated = needs(["p2-tenantrag"], ["p2-tenantrag"]);
  unrelated.changes.outputs.concurrent = "true";
  assert.throws(() => qualityResult(unrelated), /outputs/);
});

test("every selected verification must succeed, including sidecar and concurrency", () => {
  for (const job of [
    "step",
    "project",
    "p3-sidecar",
    "compose-config",
    "compose-concurrency",
  ]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const scenario = needs(
        ["p1-task-manager", "p3-mcp-capability-governance"],
        ["p1-task-manager", "p3-mcp-capability-governance"],
        true,
      );
      scenario[job].result = result;
      assert.equal(qualityResult(scenario).success, false, `${job}: ${result}`);
    }
  }
});
