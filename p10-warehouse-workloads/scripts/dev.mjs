import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  issuerHealth,
  runDevStack,
  serviceHealth,
} from "../../shared/dev-supervisor.mjs";
import {
  WORKLOADS,
  workloadAgentPort,
  workloadEnvironmentPrefix,
} from "../src/shared/catalog.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const resetFixtures = process.argv.includes("--reset");
const production = process.argv.includes("--production");

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
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("P10_")),
  );
  const common = {
    P10_ISSUER: configured.P10_ISSUER,
    P10_API_RESOURCE: configured.P10_API_RESOURCE,
  };
  const source = (name) =>
    production
      ? [`dist/server/${name}-main.js`]
      : ["--watch", `src/server/${name}-main.ts`];
  const workloadIds = WORKLOADS.map(({ id }) => id);
  return [
    {
      name: "shared identity provider",
      command: node,
      args: ["dist/main.js"],
      cwd: identityRoot,
      health: {
        url: "http://127.0.0.1:4000/.well-known/openid-configuration",
        validate: issuerHealth(configured.P10_ISSUER),
      },
    },
    {
      name: "P10 Warehouse API",
      command: node,
      args: source("api"),
      cwd: root,
      env: {
        ...base,
        ...common,
        P10_API_HOST: configured.P10_API_HOST,
        P10_API_PORT: configured.P10_API_PORT,
        P10_DATA_DIR: configured.P10_DATA_DIR,
        ...Object.fromEntries(
          workloadIds.map((id) => {
            const prefix = workloadEnvironmentPrefix(id);
            return [`${prefix}_CLIENT_ID`, configured[`${prefix}_CLIENT_ID`]];
          }),
        ),
      },
      health: {
        url: `http://127.0.0.1:${configured.P10_API_PORT}/healthz`,
        validate: serviceHealth("p10-warehouse-api"),
      },
    },
    ...workloadIds.map((id) => {
      const prefix = workloadEnvironmentPrefix(id);
      const port = String(workloadAgentPort(id));
      return {
        name: `P10 ${id} agent`,
        command: node,
        args: [...source("agent"), id],
        cwd: root,
        env: {
          ...base,
          ...common,
          P10_CONTROL_SECRET: configured.P10_CONTROL_SECRET,
          P10_WAREHOUSE_API_URL: configured.P10_WAREHOUSE_API_URL,
          P10_AGENT_PORT: port,
          [`${prefix}_CLIENT_ID`]: configured[`${prefix}_CLIENT_ID`],
          [`${prefix}_CLIENT_SECRET`]: configured[`${prefix}_CLIENT_SECRET`],
        },
        health: {
          url: `http://127.0.0.1:${port}/healthz`,
          validate: serviceHealth(`p10-agent-${id}`),
        },
      };
    }),
    {
      name: "P10 CedarStock console",
      command: node,
      args: source("console"),
      cwd: root,
      env: {
        ...base,
        P10_HOST: configured.P10_HOST,
        P10_PORT: configured.P10_PORT,
        P10_BASE_URL: configured.P10_BASE_URL,
        P10_CONTROL_SECRET: configured.P10_CONTROL_SECRET,
        P10_TRANSFER_PLANNER_URL: configured.P10_TRANSFER_PLANNER_URL,
        P10_WAREHOUSE_NORTH_URL: configured.P10_WAREHOUSE_NORTH_URL,
        P10_WAREHOUSE_SOUTH_URL: configured.P10_WAREHOUSE_SOUTH_URL,
        P10_INVENTORY_AUDITOR_URL: configured.P10_INVENTORY_AUDITOR_URL,
      },
      health: {
        url: `http://127.0.0.1:${configured.P10_PORT}/healthz`,
        validate: serviceHealth("p10-warehouse-workloads"),
      },
    },
  ];
}
