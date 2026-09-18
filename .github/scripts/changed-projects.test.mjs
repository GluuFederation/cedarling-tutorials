import assert from "node:assert/strict";
import test from "node:test";
import {
  composeProjects,
  projects,
  selectProjects,
} from "./changed-projects.mjs";

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
