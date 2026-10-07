// Verifies tutorial source validation and the portfolio validation command.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { validateTutorialProject } from "./tutorial-contract.mjs";
import { tutorialProjects } from "./changed-projects.mjs";

const project = "p1-task-manager";
const validationScript = fileURLToPath(
  new URL("./validate-tutorials.mjs", import.meta.url),
);
const socialCard = await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 3,
    background: "#102a3b",
  },
})
  .webp()
  .toBuffer();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cedarling-tutorial-validation-"));
  const assetRoot = join(root, project, "docs", "assets");
  await mkdir(assetRoot, { recursive: true });
  await writeFile(
    join(root, project, "docs", "tutorials.md"),
    `---
slug: protect-a-node-api
title: Protect a Node API
summary: Enforce one Cedarling decision at an API boundary.
order: 10
socialImage: ./assets/social-card.webp
socialImageAlt: The API checks an action with Cedarling.
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
  await writeFile(join(assetRoot, "social-card.webp"), socialCard);
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

test("validates the current tutorial source contract", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const validated = await validateTutorialProject(root, project);
  assert.deepEqual(validated.assets, ["boundary.svg", "social-card.webp"]);
  assert.equal(validated.markdown, await readFile(join(root, project, "docs", "tutorials.md"), "utf8"));
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

test("rejects a missing or incorrectly sized frontmatter social card", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const cardPath = join(root, project, "docs", "assets", "social-card.webp");
  await rm(cardPath);
  await assert.rejects(
    validateTutorialProject(root, project),
    /missing asset \.\/assets\/social-card\.webp/,
  );

  await writeFile(
    cardPath,
    await sharp({
      create: {
        width: 1200,
        height: 620,
        channels: 3,
        background: "#102a3b",
      },
    })
      .webp()
      .toBuffer(),
  );
  await assert.rejects(
    validateTutorialProject(root, project),
    /social card must be a 1200x630 WebP/,
  );
});

test("requires safe social-card metadata", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const tutorialPath = join(root, project, "docs", "tutorials.md");
  const markdown = await readFile(tutorialPath, "utf8");
  await writeFile(
    tutorialPath,
    markdown.replace(
      "socialImageAlt: The API checks an action with Cedarling.",
      "socialImageAlt: ''",
    ),
  );
  await assert.rejects(
    validateTutorialProject(root, project),
    /socialImageAlt/,
  );

  await writeFile(
    tutorialPath,
    markdown.replace("./assets/social-card.webp", "../social-card.webp"),
  );
  await assert.rejects(
    validateTutorialProject(root, project),
    /unsafe tutorial image path/,
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
  assert.deepEqual(validated.assets, ["boundary.svg", "social-card.webp"]);
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
socialImage: ./assets/social-card.webp
socialImageAlt: The API checks an action with Cedarling.
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
socialImage: ./assets/social-card.webp
socialImageAlt: The API checks an action with Cedarling.
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

test("validation accepts a portfolio with no published tutorials", async (context) => {
  const root = await portfolioFixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [validationScript, "--repository", root],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "No published tutorial sources found.\n");
});

test("validation validates the available tutorial sources", async (context) => {
  const root = await portfolioFixture(true);
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [validationScript, "--repository", root],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Validated 1 tutorial source.\n");
});

test("validation rejects a path outside the tutorial repository", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "not-a-tutorial-repository-"));
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = spawnSync(
    process.execPath,
    [validationScript, "--repository", root],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain the tutorial portfolio/);
});

test("reports missing values and unknown CLI options", () => {
  const missingValue = spawnSync(
    process.execPath,
    [validationScript, "--repository"],
    { encoding: "utf8" },
  );
  assert.notEqual(missingValue.status, 0);
  assert.match(missingValue.stderr, /argument missing/);

  const unknownOption = spawnSync(
    process.execPath,
    [validationScript, "--unknown"],
    { encoding: "utf8" },
  );
  assert.notEqual(unknownOption.status, 0);
  assert.match(unknownOption.stderr, /Unknown option '--unknown'/);
});
