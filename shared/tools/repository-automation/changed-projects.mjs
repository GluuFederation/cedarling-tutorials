// Selects the tutorial projects that CI must verify for the current change.

import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  "p14-ai-scheduling-assistant",
  "p15-marketplace",
];


export const projects = [...tutorialProjects, "shared/identity-provider"];
export const composeProjects = new Set(
  tutorialProjects.filter(
    (project) => project !== "p3-mcp-capability-governance",
  ),
);

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
    ["diff", "--name-only", `${base}${separator}${head}`],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}

export function selectProjects(files) {
  const affectsAll =
    files === null ||
    files.some(
      (file) =>
        file.startsWith(".github/") ||
        file.startsWith("shared/"),
    );
  const selected = affectsAll
    ? projects
    : projects.filter((project) =>
        files.some((file) => file.startsWith(`${project}/`)),
      );
  return {
    projects: selected,
    compose: selected.filter((project) => composeProjects.has(project)),
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
  const output = `projects=${JSON.stringify(selected.projects)}\ncompose=${JSON.stringify(selected.compose)}\n`;
  if (environment.GITHUB_OUTPUT)
    appendFileSync(environment.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
