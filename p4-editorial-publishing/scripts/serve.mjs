import { spawn } from "node:child_process";

await import("./preflight.mjs");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    process.env.P4_HOST ?? "127.0.0.1",
    "--port",
    process.env.P4_PORT ?? "3004",
  ],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 0 : (code ?? 1)));
