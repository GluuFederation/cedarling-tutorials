// Verifies CI project selection for project, shared, and repository changes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  composeProjects,
  projects,
  selectProjects,
} from "./changed-projects.mjs";

const selectorScript = fileURLToPath(
  new URL("./changed-projects.mjs", import.meta.url),
);

test("selects only the changed project", () => {
  assert.deepEqual(selectProjects(["p7-collaborative-docs/src/server/app.ts"]), {
    projects: ["p7-collaborative-docs"],
    compose: ["p7-collaborative-docs"],
  });
});

test("keeps native-only projects out of the Compose matrix", () => {
  assert.deepEqual(
    selectProjects(["p3-mcp-capability-governance/src/app.ts"]),
    {
      projects: ["p3-mcp-capability-governance"],
      compose: [],
    },
  );
  assert.equal(composeProjects.has("shared/identity-provider"), false);
});

test("selects the complete portfolio for shared and workflow changes", () => {
  assert.deepEqual(
    selectProjects(["shared/identity-provider/src/config.ts"]).projects,
    projects,
  );
  assert.deepEqual(selectProjects(["shared/dev-supervisor.mjs"]).projects, projects);
  assert.deepEqual(
    selectProjects([".github/workflows/quality.yml"]).projects,
    projects,
  );
  assert.deepEqual(selectProjects(null).projects, projects);
});

test("does not run project jobs for root documentation alone", () => {
  assert.deepEqual(selectProjects(["README.md"]), {
    projects: [],
    compose: [],
  });
});

test("reports when project detection falls back to the full matrix", () => {
  const result = spawnSync(process.execPath, [selectorScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      EVENT_NAME: "pull_request",
      BASE_SHA: "missing-base",
      HEAD_SHA: "missing-head",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /Changed-project detection failed; selecting the full project matrix/,
  );
  assert.ok(result.stdout.includes(`projects=${JSON.stringify(projects)}`));
});
