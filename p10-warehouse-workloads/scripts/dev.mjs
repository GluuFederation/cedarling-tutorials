import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { runDevStack } from "../../shared/dev-supervisor.mjs";
import { stackServices } from "./stack-services.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const resetFixtures = process.argv.includes("--reset");
const production = process.argv.includes("--production");

try {
  await runDevStack({
    prepare: [
      {
        name: "shared identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P10 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      ...(resetFixtures
        ? [
            {
              name: "P10 fixture reset",
              command: pnpm,
              args: ["run", "reset"],
              cwd: root,
            },
          ]
        : []),
      { name: "P10 build", command: pnpm, args: ["run", "build"], cwd: root },
    ],
    services,
  });
} catch (error) {
  console.error(
    `P10 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}

async function services() {
  const configured = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  return stackServices(root, configured, { production });
}
