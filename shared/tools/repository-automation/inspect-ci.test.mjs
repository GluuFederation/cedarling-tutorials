import assert from "node:assert/strict";
import test from "node:test";
import { fetchRun, inspectRun } from "./inspect-ci.mjs";

const complete = { status: "completed", conclusion: "success" };
const job = {
  ...complete,
  name: "example",
  created_at: "2026-10-22T18:00:00Z",
  started_at: "2026-10-22T18:01:00Z",
  completed_at: "2026-10-22T18:03:00Z",
  steps: [
    {
      name: "Install",
      ...complete,
      started_at: "2026-10-22T18:01:00Z",
      completed_at: "2026-10-22T18:02:30Z",
    },
  ],
};

test("inspection separates queue and execution durations and identifies slow stages", () => {
  const result = inspectRun(complete, [job]);
  assert.equal(result.success, true);
  assert.equal(result.jobs[0].queuedSeconds, 60);
  assert.equal(result.jobs[0].executionSeconds, 120);
  assert.equal(result.jobs[0].slowSteps[0].seconds, 90);
});

test("completed steps never turn an unresolved or cancelled job green", () => {
  const stale = {
    ...job,
    status: "in_progress",
    conclusion: null,
    completed_at: null,
    steps: [
      ...job.steps,
      { name: "Complete job", ...complete, completed_at: job.completed_at },
    ],
  };
  const result = inspectRun(complete, [stale]);
  assert.equal(result.jobs[0].stale, true);
  assert.equal(result.jobs[0].executionSeconds, 120);
  assert.equal(result.success, false);
  assert.equal(
    inspectRun(complete, [{ ...job, conclusion: "cancelled" }]).success,
    false,
  );
  assert.equal(
    inspectRun({ status: "in_progress", conclusion: null }, [job]).success,
    false,
  );
});

test("inspection handles queued jobs without inventing execution timings", () => {
  const result = inspectRun({ status: "queued" }, [
    { name: "waiting", status: "queued", steps: [] },
  ]);
  assert.equal(result.jobs[0].executionSeconds, null);
  assert.equal(result.jobs[0].queuedSeconds, null);
  assert.equal(result.success, false);
});

test("inspection reads every jobs page with GET-only gh calls", () => {
  const calls = [];
  const result = fetchRun("123", (_file, args) => {
    calls.push(args);
    return JSON.stringify(
      args[1].endsWith("/123")
        ? complete
        : [{ jobs: [job] }, { jobs: [{ ...job, name: "second" }] }],
    );
  });
  assert.equal(result.jobs.length, 2);
  assert.equal(
    calls.every((args) => args[0] === "api" && !args.includes("--method")),
    true,
  );
  assert.throws(() => fetchRun("123;unsafe"), /Usage/);
});
