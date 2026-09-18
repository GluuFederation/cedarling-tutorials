import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("synchronizes four workload registrations while preserving local settings", () => {
  const root = mkdtempSync(resolve(tmpdir(), "p10-setup-"));
  roots.push(root);
  const project = resolve(root, "p10-warehouse-workloads");
  const identity = resolve(root, "shared/identity-provider");
  mkdirSync(project, { recursive: true });
  mkdirSync(identity, { recursive: true });
  const prefixes = [
    "P10_TRANSFER_PLANNER",
    "P10_WAREHOUSE_NORTH",
    "P10_WAREHOUSE_SOUTH",
    "P10_INVENTORY_AUDITOR",
  ];
  writeFileSync(
    resolve(identity, ".env"),
    [
      "IDP_ISSUER=http://idp.localhost:4000",
      "P10_API_RESOURCE=http://p10.localhost:3010/api",
      ...prefixes.flatMap((prefix, index) => [
        `${prefix}_CLIENT_ID=${prefix.toLowerCase().replaceAll("_", "-")}`,
        `${prefix}_CLIENT_SECRET=${String(index + 1).repeat(32)}`,
      ]),
      "",
    ].join("\n"),
  );
  const target = resolve(project, ".env");
  writeFileSync(target, "P10_LOCAL_NOTE=keep\n");

  const result = spawnSync(process.execPath, [resolve("scripts/setup.ts")], {
    cwd: project,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const environment = parseEnv(readFileSync(target, "utf8"));
  expect(environment.P10_LOCAL_NOTE).toBe("keep");
  for (const [index, prefix] of prefixes.entries()) {
    expect(environment[`${prefix}_CLIENT_SECRET`]).toBe(
      String(index + 1).repeat(32),
    );
  }
  expect(environment.P10_CONTROL_SECRET).toHaveLength(43);
  if (process.platform !== "win32")
    expect(statSync(target).mode & 0o777).toBe(0o600);
});
