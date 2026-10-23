// Reads workflow metadata only; it never cancels, reruns, or changes a check.
import { execFileSync } from "node:child_process";

const repository = "GluuFederation/cedarling-tutorials";
const seconds = (start, end) => {
  const duration = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(duration) && duration >= 0
    ? Math.round(duration)
    : null;
};

export function inspectRun(run, jobs) {
  const rows = jobs.map((job) => {
    const steps = job.steps ?? [];
    const last = steps.at(-1);
    const stale =
      job.status !== "completed" &&
      last?.name === "Complete job" &&
      last.status === "completed";
    return {
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      queuedSeconds: seconds(job.created_at, job.started_at),
      executionSeconds: seconds(
        job.started_at,
        stale ? last.completed_at : job.completed_at,
      ),
      stale,
      slowSteps: steps
        .map((step) => ({
          name: step.name,
          conclusion: step.conclusion,
          seconds: seconds(step.started_at, step.completed_at),
        }))
        .filter(
          (step) =>
            step.seconds >= 30 ||
            ["failure", "cancelled"].includes(step.conclusion),
        ),
    };
  });
  return {
    status: run.status,
    conclusion: run.conclusion,
    jobs: rows,
    success:
      rows.length > 0 &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      rows.every(
        (job) =>
          job.status === "completed" &&
          ["success", "skipped"].includes(job.conclusion),
      ),
  };
}

export function fetchRun(id, execute = execFileSync) {
  if (!/^[1-9][0-9]{0,15}$/.test(String(id)))
    throw new Error("Usage: pnpm inspect:ci <run-id>");
  const get = (path, paginate = false) =>
    JSON.parse(
      execute(
        "gh",
        ["api", path, ...(paginate ? ["--paginate", "--slurp"] : [])],
        {
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 32 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      ),
    );
  const run = get(`repos/${repository}/actions/runs/${id}`);
  const pages = get(
    `repos/${repository}/actions/runs/${id}/jobs?filter=latest&per_page=100`,
    true,
  );
  return inspectRun(
    run,
    pages.flatMap((page) => page.jobs),
  );
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2).filter((value) => value !== "--");
    if (args.length !== 1) throw new Error("Usage: pnpm inspect:ci <run-id>");
    const result = fetchRun(args[0]);
    console.info(
      `Workflow: ${result.status}; result: ${result.conclusion ?? "pending"}`,
    );
    for (const job of result.jobs) {
      console.info(
        `${job.name}: ${job.conclusion ?? job.status}; queued ${job.queuedSeconds ?? "?"}s; execution ${job.executionSeconds ?? "?"}s${job.stale ? "; final step completed, GitHub status is unresolved" : ""}`,
      );
      for (const step of job.slowSteps)
        console.info(
          `  ${step.name}: ${step.seconds ?? "?"}s; ${step.conclusion ?? "pending"}`,
        );
    }
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
