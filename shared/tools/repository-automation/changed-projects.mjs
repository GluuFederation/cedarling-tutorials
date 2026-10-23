// Selects the tutorial projects that CI must verify for the current change.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const tutorialProjects = [
  "p1-task-manager",
  "p2-tenantrag",
  "p3-mcp-capability-governance",
  "p4-editorial-publishing",
  "p5-dataguard",
  "p6-field-inspection",
  "p7-collaborative-docs",
  "p8-cedarfile",
  "p9-cedarrealtime",
  "p10-warehouse-workloads",
  "p11-saas-workspace",
  "p12-hr-access-governance",
  "p13-student-records",
  "p14-capital-district",
  "p15-marketplace",
];
export const projects = [...tutorialProjects, "shared/identity-provider"];
export const composeProjects = new Set(tutorialProjects);

function changedFiles(environment = process.env) {
  const event = environment.EVENT_NAME;
  if (event === "schedule" || event === "workflow_dispatch") return null;

  const head = environment.HEAD_SHA;
  const base =
    event === "pull_request" ? environment.BASE_SHA : environment.BEFORE_SHA;
  if (!base || !head || /^0+$/.test(base)) return null;

  const separator = event === "pull_request" ? "..." : "..";
  return execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      `${base}${separator}${head}`,
      "--",
    ],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
}

export function selectProjects(files) {
  const all = () => ({ projects, compose: [...composeProjects], helper: true });
  if (files === null) return all();
  const affected = new Set();
  let helper = false;
  for (const file of files) {
    if (
      [
        "README.md",
        "LICENSE",
        "shared/tools/repository-automation/README.md",
      ].includes(file)
    )
      continue;
    if (file.startsWith("shared/tools/step/")) {
      helper = true;
      continue;
    }
    const project = projects.find((name) => file.startsWith(`${name}/`));
    if (!project) return all();
    const path = file.slice(project.length + 1);
    if (
      path === "README.md" ||
      path === "docs/tutorials.md" ||
      /^docs\/assets\/[A-Za-z0-9_./-]+\.(avif|jpe?g|png|svg|webp)$/.test(path)
    )
      continue;
    // Shared runtime changes affect every application using that runtime.
    if (project === "shared/identity-provider") return all();
    affected.add(project);
  }
  const selected = projects.filter((project) => affected.has(project));
  return {
    projects: selected,
    compose: selected.filter((project) => composeProjects.has(project)),
    helper,
  };
}

function main(environment = process.env) {
  let files;
  try {
    files = changedFiles(environment);
  } catch {
    process.stderr.write(
      "Changed-project detection failed; selecting the full project matrix.\n",
    );
    files = null;
  }
  const selected = selectProjects(files);
  const output = `projects=${JSON.stringify(selected.projects)}\ncompose=${JSON.stringify(selected.compose)}\nhelper=${selected.helper}\n`;
  if (environment.GITHUB_OUTPUT)
    appendFileSync(environment.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
