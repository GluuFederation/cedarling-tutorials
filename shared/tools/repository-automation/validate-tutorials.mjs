// Validates every available project tutorial before its source is merged.
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { tutorialProjects } from "./changed-projects.mjs";
import { validateTutorialProject } from "./tutorial-contract.mjs";

async function main() {
  const { values } = parseArgs({ options: { repository: { type: "string" } } });
  const root = resolve(values.repository ?? process.cwd());
  for (const project of tutorialProjects) {
    const stat = await lstat(join(root, project)).catch(() => undefined);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`repository root does not contain the tutorial portfolio: ${project}`);
    }
  }
  let count = 0;
  for (const project of tutorialProjects) {
    try {
      await lstat(join(root, project, "docs", "tutorials.md"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await validateTutorialProject(root, project);
    count += 1;
  }
  process.stdout.write(count === 0
    ? "No published tutorial sources found.\n"
    : `Validated ${count} tutorial source${count === 1 ? "" : "s"}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
