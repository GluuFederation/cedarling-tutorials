// Validates, stages, and finalizes versioned tutorial release bundles.

import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { tutorialProjects } from "./changed-projects.mjs";
import {
  tutorialLimits,
  validateTutorialProject as validateTutorialContract,
} from "./tutorial-contract.mjs";

const commitPattern = /^[0-9a-f]{40}$/;
const tagVersionPattern =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const mebibyte = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function mebibytes(bytes) {
  return `${bytes / mebibyte} MiB`;
}

async function regularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(`${label} is missing: ${path}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail(`${label} must be a regular file: ${path}`);
  }
  return stats;
}

export function parseReleaseTag(tag) {
  const project = tutorialProjects.find((candidate) =>
    tag.startsWith(`${candidate}-`),
  );
  if (project === undefined)
    fail(`release tag must start with a known project name: ${tag}`);
  if (!tagVersionPattern.test(tag.slice(project.length + 1))) {
    fail(`release tag must use ${project}-vX.Y.Z`);
  }
  return project;
}

export function validateTutorialProject(repositoryRoot, project) {
  return validateTutorialContract(repositoryRoot, project, tutorialProjects);
}

function releaseDirectory(repositoryRoot) {
  return join(resolve(repositoryRoot), ".release");
}

export async function prepareRelease({ repositoryRoot, sourceCommit, tag }) {
  if (!commitPattern.test(sourceCommit))
    fail("source commit must be a 40-character lowercase SHA");
  const project = parseReleaseTag(tag);
  const tutorial = await validateTutorialProject(repositoryRoot, project);
  const destination = releaseDirectory(repositoryRoot);
  const stage = join(destination, "stage");
  await rm(destination, { force: true, recursive: true });
  await mkdir(join(stage, "docs"), { recursive: true });
  await writeFile(
    join(stage, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, project, releaseTag: tag, sourceCommit }, null, 2)}\n`,
  );
  await writeFile(join(stage, "docs", "tutorials.md"), tutorial.markdown);
  if (tutorial.assets.length > 0) {
    await mkdir(join(stage, "docs", "assets"), { recursive: true });
    for (const asset of tutorial.assets) {
      const source = join(
        repositoryRoot,
        project,
        "docs",
        "assets",
        ...asset.split("/"),
      );
      const target = join(stage, "docs", "assets", ...asset.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { dereference: false, errorOnExist: true });
    }
  }
  const archive = `${project}-tutorial.zip`;
  await writeFile(
    join(destination, "release.env"),
    `ARCHIVE=${archive}\n`,
  );
}

export async function finalizeRelease({ repositoryRoot, sourceCommit, tag }) {
  if (!commitPattern.test(sourceCommit))
    fail("source commit must be a 40-character lowercase SHA");
  const project = parseReleaseTag(tag);
  const destination = releaseDirectory(repositoryRoot);
  const archive = `${project}-tutorial.zip`;
  const archivePath = join(destination, archive);
  const stats = await regularFile(archivePath, "tutorial archive");
  if (stats.size > tutorialLimits.bundleBytes)
    fail(
      `${archive}: exceeds ${mebibytes(tutorialLimits.bundleBytes)} compressed`,
    );
  const archiveBytes = await readFile(archivePath);
  if (!archiveBytes.subarray(0, zipHeader.length).equals(zipHeader)) {
    fail(`${archive}: does not have a ZIP header`);
  }
  const digest = createHash("sha256")
    .update(archiveBytes)
    .digest("hex");
  const registryEntry = {
    project,
    releaseTag: tag,
    sourceCommit,
    archiveSha256: digest,
  };
  await writeFile(
    join(destination, `${archive}.sha256`),
    `${digest}  ${archive}\n`,
  );
  await writeFile(
    join(destination, "registry-entry.json"),
    `${JSON.stringify(registryEntry, null, 2)}\n`,
  );
  await writeFile(
    join(destination, "release-notes.md"),
    `Tutorial source bundle for \`${project}\`.\n\nSource commit: \`${sourceCommit}\`\n\nCedarling.dev registry entry:\n\n\`\`\`json\n${JSON.stringify(registryEntry, null, 2)}\n\`\`\`\n`,
  );
}

async function validateAll(repositoryRoot) {
  const invalidProjects = [];
  for (const project of tutorialProjects) {
    try {
      const stats = await lstat(join(repositoryRoot, project));
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        invalidProjects.push(project);
      }
    } catch {
      invalidProjects.push(project);
    }
  }
  if (invalidProjects.length > 0) {
    fail(
      `repository root does not contain the tutorial portfolio: ${invalidProjects.join(", ")}`,
    );
  }

  let count = 0;
  for (const project of tutorialProjects) {
    try {
      await lstat(join(repositoryRoot, project, "docs", "tutorials.md"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await validateTutorialProject(repositoryRoot, project);
    count += 1;
  }
  process.stdout.write(
    count === 0
      ? "No published tutorial sources found.\n"
      : `Validated ${count} tutorial source${count === 1 ? "" : "s"}.\n`,
  );
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      repository: { type: "string" },
      tag: { type: "string" },
      "source-commit": { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    fail("command must be validate-all, prepare, or finalize");
  }
  const [command] = positionals;
  if (!["validate-all", "prepare", "finalize"].includes(command)) {
    fail("command must be validate-all, prepare, or finalize");
  }
  const repositoryRoot = resolve(values.repository ?? process.cwd());
  if (command === "validate-all") {
    if (values.tag || values["source-commit"]) {
      fail("validate-all accepts only --repository");
    }
    await validateAll(repositoryRoot);
    return;
  }
  const tag = values.tag;
  const sourceCommit = values["source-commit"];
  if (!tag || !sourceCommit) fail("--tag and --source-commit are required");
  if (command === "prepare")
    await prepareRelease({ repositoryRoot, sourceCommit, tag });
  else
    await finalizeRelease({ repositoryRoot, sourceCommit, tag });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
