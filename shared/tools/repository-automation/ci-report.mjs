// Writes runner identity and step outcomes without environment dumps or step outputs.
import { appendFile } from "node:fs/promises";
import { arch, platform } from "node:os";

const stages = {
  install: "Install",
  identity: "Shared identity provider",
  "browser-linux": "Linux browser setup",
  browser: "Browser download",
  check: "Checks",
  integration: "Linux integration",
  audit: "Dependency audit",
};

export function stageReport(steps) {
  return `### Verification stages\n\n| Stage | Result |\n|---|---|\n${Object.entries(
    stages,
  )
    .map(([id, label]) => {
      const outcome = steps?.[id]?.outcome;
      const result = ["success", "failure", "cancelled", "skipped"].includes(
        outcome,
      )
        ? outcome
        : "not run";
      return `| ${label} | ${result} |`;
    })
    .join("\n")}\n`;
}

if (import.meta.main) {
  try {
    const mode = process.argv[2];
    let text;
    if (mode === "runner") {
      const value = (input) =>
        String(input ?? "unknown").replace(/[^A-Za-z0-9_.:/+-]/g, "");
      text = `Runner: ${platform()}/${arch()}, ${value(process.env.ImageOS)} ${value(process.env.ImageVersion)}, Node ${process.version}.\n`;
    } else if (mode === "stages")
      text = stageReport(JSON.parse(process.env.STEPS_JSON ?? "{}"));
    else throw new Error("Usage: node ci-report.mjs runner|stages");
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
    console.info(text);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
