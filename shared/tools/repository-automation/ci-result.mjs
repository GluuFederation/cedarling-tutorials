// Fails the workflow when selected verification did not complete successfully.
import { appendFile } from "node:fs/promises";
import {
  composeProjects,
  needsConcurrentStacks,
  projects,
} from "./changed-projects.mjs";

export function qualityResult(needs) {
  if (needs?.changes?.result !== "success")
    throw new Error("Project selection did not succeed");
  const outputs = needs.changes.outputs;
  const selected = JSON.parse(outputs.projects);
  const compose = JSON.parse(outputs.compose);
  if (
    !Array.isArray(selected) ||
    new Set(selected).size !== selected.length ||
    !selected.every((id) => projects.includes(id)) ||
    !Array.isArray(compose) ||
    !compose.every((id) => composeProjects.has(id) && selected.includes(id)) ||
    JSON.stringify(compose) !==
      JSON.stringify(selected.filter((id) => composeProjects.has(id))) ||
    !["true", "false"].includes(outputs.helper) ||
    outputs.concurrent !== String(needsConcurrentStacks(selected))
  )
    throw new Error("Invalid CI selection outputs");
  const expected = {
    step: outputs.helper === "true",
    project: selected.length > 0,
    "p3-sidecar": selected.includes("p3-mcp-capability-governance"),
    "compose-config": compose.length > 0,
    "compose-concurrency": outputs.concurrent === "true",
  };
  const rows = Object.entries(expected).map(([job, required]) => {
    const result = needs[job]?.result ?? "missing";
    return {
      job,
      required,
      result,
      valid: result === "success" || (!required && result === "skipped"),
    };
  });
  return { selected, compose, rows, success: rows.every((row) => row.valid) };
}

if (import.meta.main) {
  try {
    const result = qualityResult(JSON.parse(process.env.NEEDS_JSON ?? "null"));
    const text = `## Quality result\n\nProjects: ${result.selected.join(", ") || "none"}.\n\n| Job | Selected | Result |\n|---|---|---|\n${result.rows.map((row) => `| ${row.job} | ${row.required ? "yes" : "no"} | ${row.result} |`).join("\n")}\n`;
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
    console.info(text);
    if (!result.success)
      throw new Error(
        "Selected verification failed, was cancelled, or did not run",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
