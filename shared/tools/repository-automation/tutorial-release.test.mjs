// Verifies tutorial validation, staging, and release metadata behavior.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  finalizeRelease,
  parseReleaseTag,
  prepareRelease,
  validateTutorialProject,
} from "./tutorial-release.mjs";
import { tutorialProjects } from "./changed-projects.mjs";
import { tutorialLimits } from "./tutorial-contract.mjs";

const project = "p1-task-manager";
const tag = `${project}-v1.0.0`;
const sourceCommit = "a".repeat(40);
const releaseScript = fileURLToPath(
  new URL("./tutorial-release.mjs", import.meta.url),
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cedarling-tutorial-release-"));
  const assetRoot = join(root, project, "docs", "assets");
  await mkdir(assetRoot, { recursive: true });
  await writeFile(
    join(root, project, "docs", "tutorials.md"),
    `---
slug: protect-a-node-api
title: Protect a Node API
summary: Enforce one Cedarling decision at an API boundary.
order: 10
lastVerified: 2026-09-01T12:00:00Z
---

# Protect a Node API

![Authorization boundary](./assets/boundary.svg)
`,
  );
  await writeFile(
    join(assetRoot, "boundary.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
  );
  return root;
}

async function portfolioFixture(withTutorial = false) {
  const root = withTutorial
    ? await fixture()
    : await mkdtemp(join(tmpdir(), "cedarling-tutorial-portfolio-"));
  await Promise.all(
    tutorialProjects.map((candidate) =>
      mkdir(join(root, candidate), { recursive: true }),
    ),
  );
  return root;
}

test("validates and stages the current tutorial source contract", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  const validated = await validateTutorialProject(root, project);
  assert.deepEqual(validated.assets, ["boundary.svg"]);

  const prepared = spawnSync(
    process.execPath,
    [releaseScript, "prepare", "--tag", tag, "--source-commit", sourceCommit],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, ".release", "stage", "manifest.json"), "utf8"),
    ),
    { schemaVersion: 1, project, releaseTag: tag, sourceCommit },
  );
  assert.equal(
    await readFile(
      join(root, ".release", "stage", "docs", "assets", "boundary.svg"),
      "utf8",
    ),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
  );
  assert.equal(
    await readFile(join(root, ".release", "release.env"), "utf8"),
    `ARCHIVE=${project}-tutorial.zip\n`,
  );
});

test("rejects a tutorial whose referenced asset is unavailable", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  await rm(join(root, project, "docs", "assets", "boundary.svg"));

  await assert.rejects(
    validateTutorialProject(root, project),
    /missing asset \.\/assets\/boundary\.svg/,
  );
});

test("rejects non-canonical tutorial asset paths", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const tutorialPath = join(root, project, "docs", "tutorials.md");
  await writeFile(
    tutorialPath,
    (await readFile(tutorialPath, "utf8")).replace(
      "./assets/boundary.svg",
      "./assets/./boundary.svg",
    ),
  );

  await assert.rejects(
    validateTutorialProject(root, project),
    /unsupported or unsafe tutorial image/,
  );
});

test("ignores Markdown syntax inside code", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const tutorialPath = join(root, project, "docs", "tutorials.md");
  await writeFile(
    tutorialPath,
    `${await readFile(tutorialPath, "utf8")}
\`\`\`markdown
# Not a tutorial heading
![Not an asset](./assets/missing-fenced.svg)
\`\`\`

\`![Not an asset](./assets/missing-inline.svg)\`

    # Not a tutorial heading
    ![Not an asset](./assets/missing-indented.svg)
`,
  );

  const validated = await validateTutorialProject(root, project);
  assert.deepEqual(validated.assets, ["boundary.svg"]);
});

test("rejects reference-style tutorial images", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const tutorialPath = join(root, project, "docs", "tutorials.md");
  await writeFile(
    tutorialPath,
    (await readFile(tutorialPath, "utf8")).replace(
      "![Authorization boundary](./assets/boundary.svg)",
      "![Authorization boundary][boundary]\n\n[boundary]: ./assets/boundary.svg",
    ),
  );

  await assert.rejects(
    validateTutorialProject(root, project),
    /image references must use inline relative paths/,
  );
});

test("uses YAML types instead of treating every scalar as text", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, project, "docs", "tutorials.md"),
    `---
slug: protect-a-node-api
title: true
summary: null
order: 10
lastVerified: 2026-09-01T12:00:00Z
---

# true
`,
  );

  await assert.rejects(
    validateTutorialProject(root, project),
    /expected string, received boolean.*expected string, received null/,
  );
});

test("fully decodes raster assets before accepting them", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const assetRoot = join(root, project, "docs", "assets");
  await rm(join(assetRoot, "boundary.svg"));
  await writeFile(
    join(root, project, "docs", "tutorials.md"),
    `---
slug: protect-a-node-api
title: Protect a Node API
summary: Enforce one Cedarling decision at an API boundary.
order: 10
lastVerified: 2026-09-01T12:00:00Z
---

# Protect a Node API

![Authorization boundary](./assets/boundary.png)
`,
  );
  await writeFile(
    join(assetRoot, "boundary.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  await assert.rejects(
    validateTutorialProject(root, project),
    /image is corrupt/,
  );
});

test("rejects active SVG content", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, project, "docs", "assets", "boundary.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );

  await assert.rejects(
    validateTutorialProject(root, project),
    /SVG contains active or external content/,
  );
});

test("accepts inert SVG definitions and internal references", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, project, "docs", "assets", "boundary.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#paint)"/></svg>',
  );

  await validateTutorialProject(root, project);
});

test("rejects SVG content changed by sanitization", async (context) => {
  const unsafeSources = [
    '<svg xmlns="http://www.w3.org/2000/svg"><unknown/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/a.svg#icon"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.com/a.svg#paint)"/></svg>',
  ];

  for (const source of unsafeSources) {
    const root = await fixture();
    try {
      await writeFile(
        join(root, project, "docs", "assets", "boundary.svg"),
        source,
      );
      await assert.rejects(
        validateTutorialProject(root, project),
        /SVG contains (?:active or external|unsupported) content/,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("writes the archive checksum and Cedarling.dev registry entry", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const output = join(root, ".release");
  await mkdir(output, { recursive: true });
  const archive = `${project}-tutorial.zip`;
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x66, 0x69, 0x78]);
  await writeFile(join(output, archive), bytes);

  const finalized = spawnSync(
    process.execPath,
    [releaseScript, "finalize", "--tag", tag, "--source-commit", sourceCommit],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(finalized.status, 0, finalized.stderr);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    await readFile(join(output, `${archive}.sha256`), "utf8"),
    `${digest}  ${archive}\n`,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(output, "registry-entry.json"), "utf8")),
    {
      project,
      releaseTag: tag,
      sourceCommit,
      archiveSha256: digest,
    },
  );
});

test("accepts only explicit project semantic-version tags", () => {
  assert.equal(parseReleaseTag(tag), project);
  assert.throws(() => parseReleaseTag(`${project}-latest`), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag(`${project}-v01.0.0`), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("unknown-v1.0.0"), /known project/);
});

test("rejects invalid release inputs before writing output", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(
    prepareRelease({ repositoryRoot: root, sourceCommit: "invalid", tag }),
    /40-character lowercase SHA/,
  );

  const output = join(root, ".release");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, `${project}-tutorial.zip`),
    Buffer.alloc(tutorialLimits.bundleBytes + 1),
  );
  await assert.rejects(
    finalizeRelease({ repositoryRoot: root, sourceCommit, tag }),
    new RegExp(
      `exceeds ${tutorialLimits.bundleBytes / (1024 * 1024)} MiB compressed`,
    ),
  );
});

test("rejects a release artifact without a ZIP header", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const output = join(root, ".release");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, `${project}-tutorial.zip`), "not a zip");

  await assert.rejects(
    finalizeRelease({ repositoryRoot: root, sourceCommit, tag }),
    /does not have a ZIP header/,
  );
});

test("validate-all accepts a portfolio with no published tutorials", async (context) => {
  const root = await portfolioFixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [releaseScript, "validate-all", "--repository", root],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "No published tutorial sources found.\n");
});

test("validate-all validates the available tutorial sources", async (context) => {
  const root = await portfolioFixture(true);
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [releaseScript, "validate-all", "--repository", root],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Validated 1 tutorial source.\n");
});

test("validate-all rejects a path outside the tutorial repository", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "not-a-tutorial-repository-"));
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [releaseScript, "validate-all", "--repository", root],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain the tutorial portfolio/);
});

test("reports missing values and unknown CLI options", () => {
  const missingValue = spawnSync(
    process.execPath,
    [releaseScript, "prepare", "--tag"],
    { encoding: "utf8" },
  );
  assert.notEqual(missingValue.status, 0);
  assert.match(missingValue.stderr, /argument missing/);

  const unknownOption = spawnSync(
    process.execPath,
    [releaseScript, "validate-all", "--unknown"],
    { encoding: "utf8" },
  );
  assert.notEqual(unknownOption.status, 0);
  assert.match(unknownOption.stderr, /Unknown option '--unknown'/);
});
