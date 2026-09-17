import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  issuerHealth,
  runDevStack,
  serviceHealth,
} from "../../shared/dev-supervisor.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const resetFixtures = process.argv.includes("--reset");

try {
  await runDevStack({
    prepare: [
      {
        name: "shared identity-provider setup",
        command: pnpm,
        args: ["run", "setup"],
        cwd: identityRoot,
      },
      {
        name: "shared identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P5 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      ...(resetFixtures
        ? [
            {
              name: "P5 fixture reset",
              command: pnpm,
              args: ["run", "reset"],
              cwd: root,
            },
          ]
        : []),
      { name: "P5 build", command: pnpm, args: ["run", "build"], cwd: root },
    ],
    services,
  });
} catch (error) {
  console.error(
    `P5 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}

async function services() {
  const configured = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const issuer = configured.P5_ISSUER ?? "http://idp.localhost:4000";
  const idpPort = new URL(issuer).port || "4000";
  return [
    {
      name: "shared identity provider",
      command: node,
      args: ["dist/main.js"],
      cwd: identityRoot,
      health: {
        url: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
        validate: issuerHealth(issuer),
      },
    },
    {
      name: "P5 application",
      command: node,
      args: ["--env-file=.env", "--watch", "src/server/main.ts"],
      cwd: root,
      health: {
        url: `http://127.0.0.1:${configured.P5_PORT ?? "3005"}/health`,
        validate: serviceHealth("p5-dataguard"),
      },
    },
  ];
}
