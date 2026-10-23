// Verifies CI project selection for project, shared, and repository changes.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  assert.deepEqual(
    selectProjects(["p7-collaborative-docs/src/server/app.ts"]),
    {
      projects: ["p7-collaborative-docs"],
      compose: ["p7-collaborative-docs"],
      helper: false,
    },
  );
});

test("selects Capital District for a P14 game change", () => {
  assert.deepEqual(
    selectProjects(["p14-capital-district/src/server/game/service.ts"]),
    {
      projects: ["p14-capital-district"],
      compose: ["p14-capital-district"],
      helper: false,
    },
  );
});

test("selects P3 Compose without a separate shared-provider stack", () => {
  assert.deepEqual(
    selectProjects(["p3-mcp-capability-governance/src/app.ts"]),
    {
      projects: ["p3-mcp-capability-governance"],
      compose: ["p3-mcp-capability-governance"],
      helper: false,
    },
  );
  assert.equal(composeProjects.has("shared/identity-provider"), false);
});

test("selects the complete portfolio for shared and workflow changes", () => {
  assert.deepEqual(
    selectProjects(["shared/identity-provider/src/config.ts"]).projects,
    projects,
  );
  assert.deepEqual(
    selectProjects(["shared/dev-supervisor.mjs"]).projects,
    projects,
  );
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
    helper: false,
  });
});

test("tutorial and README changes need validation without application matrices", () => {
  assert.deepEqual(
    selectProjects([
      "p1-task-manager/docs/tutorials.md",
      "p4-editorial-publishing/docs/assets/social-card.webp",
      "p6-field-inspection/README.md",
      "shared/tools/repository-automation/README.md",
    ]),
    { projects: [], compose: [], helper: false },
  );
});

test("helper changes select its portable tests without unrelated applications", () => {
  assert.deepEqual(selectProjects(["shared/tools/step/run.mjs"]), {
    projects: [],
    compose: [],
    helper: true,
  });
  assert.deepEqual(
    selectProjects([
      "shared/tools/step/projects/p1.json",
      "p1-task-manager/src/server/app.ts",
    ]),
    {
      projects: ["p1-task-manager"],
      compose: ["p1-task-manager"],
      helper: true,
    },
  );
});

test("unknown paths and scheduled runs conservatively select everything", () => {
  for (const files of [
    null,
    ["scripts/new-tool.mjs"],
    [".nvmrc"],
    ["new-project/app.ts"],
  ]) {
    assert.deepEqual(selectProjects(files), {
      projects,
      compose: [...composeProjects],
      helper: true,
    });
  }
  assert.deepEqual(
    selectProjects(["p1-task-manager/docs/execute.ts"]).projects,
    ["p1-task-manager"],
  );
  assert.deepEqual(
    selectProjects(["p1-task-manager/src/odd\nname.ts"]).projects,
    ["p1-task-manager"],
  );
});

test("reports when project detection falls back to the full matrix", () => {
  const environment = {
    ...process.env,
    EVENT_NAME: "pull_request",
    BASE_SHA: "missing-base",
    HEAD_SHA: "missing-head",
  };
  delete environment.GITHUB_OUTPUT;

  const result = spawnSync(process.execPath, [selectorScript], {
    encoding: "utf8",
    env: environment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /Changed-project detection failed; selecting the full project matrix/,
  );
  assert.ok(result.stdout.includes(`projects=${JSON.stringify(projects)}`));
});

test("CLI accounts for deleted files, source-to-doc renames, and embedded newlines", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ci-selection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  const put = async (path) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "example\n");
  };
  await put("p1-task-manager/src/old.ts");
  await put("p7-collaborative-docs/src/odd\nname.ts");
  git("add", ".");
  const commit = () =>
    git(
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=CI test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
  commit();
  const base = git("rev-parse", "HEAD");
  await mkdir(join(root, "p1-task-manager/docs"));
  await rename(
    join(root, "p1-task-manager/src/old.ts"),
    join(root, "p1-task-manager/docs/tutorials.md"),
  );
  await rm(join(root, "p7-collaborative-docs/src/odd\nname.ts"));
  git("add", "-A");
  commit();
  const env = {
    ...process.env,
    EVENT_NAME: "push",
    BEFORE_SHA: base,
    HEAD_SHA: git("rev-parse", "HEAD"),
  };
  delete env.GITHUB_OUTPUT;
  const result = spawnSync(process.execPath, [selectorScript], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /projects=\["p1-task-manager","p7-collaborative-docs"\]/,
  );
  assert.match(result.stdout, /helper=false/);
});
