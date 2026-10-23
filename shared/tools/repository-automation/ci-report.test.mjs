import assert from "node:assert/strict";
import test from "node:test";
import { stageReport } from "./ci-report.mjs";

test("stage reports distinguish failure, cancellation, and intentional skips", () => {
  const report = stageReport({
    install: { outcome: "success" },
    check: { outcome: "failure" },
    integration: { outcome: "skipped" },
    browser: { outcome: "cancelled" },
  });
  assert.match(report, /Checks \| failure/);
  assert.match(report, /Browser download \| cancelled/);
  assert.match(report, /Linux integration \| skipped/);
  assert.match(report, /Dependency audit \| not run/);
});

test("reports publish known outcomes without step outputs or arbitrary fields", () => {
  const report = stageReport({
    install: {
      outcome: "success",
      outputs: { credentials: "sensitive-fixture" },
    },
    custom: { outcome: "unsafe-fixture" },
    audit: { outcome: "unexpected-fixture" },
  });
  assert.doesNotMatch(
    report,
    /sensitive-fixture|unsafe-fixture|unexpected-fixture/,
  );
});
