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

it.each([17010, 4210])(
  "synchronizes registration port %s while preserving internal endpoints and credentials",
  (port) => {
    const root = mkdtempSync(resolve(tmpdir(), "p10-setup-"));
    roots.push(root);
    const project = resolve(root, "p10-warehouse-workloads");
    const identity = resolve(project, ".local/idp");
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
        "IDP_ISSUER=http://localhost:18010",
        `P10_API_RESOURCE=http://localhost:${port}/api`,
        ...prefixes.flatMap((prefix, index) => [
          `${prefix}_CLIENT_ID=${prefix.toLowerCase().replaceAll("_", "-")}`,
          `${prefix}_CLIENT_SECRET=${String(index + 1).repeat(32)}`,
        ]),
        "",
      ].join("\n"),
    );
    const target = resolve(project, ".env");
    writeFileSync(
      target,
      "P10_LOCAL_NOTE=keep\nP10_PORT=3010\nP10_BASE_URL=http://p10.localhost:3010\nP10_API_PORT=4110\nP10_WAREHOUSE_API_URL=http://127.0.0.1:4110\nP10_CONTROL_SECRET=learner-control-secret-32-characters\n",
    );

    const result = spawnSync(process.execPath, [resolve("scripts/setup.ts")], {
      cwd: project,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const environment = parseEnv(readFileSync(target, "utf8"));
    expect(environment.P10_LOCAL_NOTE).toBe("keep");
    expect(environment.P10_PORT).toBe(String(port));
    expect(environment.P10_BASE_URL).toBe(`http://localhost:${port}`);
    expect(environment.P10_API_PORT).toBe("4110");
    expect(environment.P10_WAREHOUSE_API_URL).toBe("http://127.0.0.1:4110");
    for (const [index, prefix] of prefixes.entries()) {
      expect(environment[`${prefix}_CLIENT_SECRET`]).toBe(
        String(index + 1).repeat(32),
      );
    }
    expect(environment.P10_CONTROL_SECRET).toBe(
      "learner-control-secret-32-characters",
    );
    if (process.platform !== "win32")
      expect(statSync(target).mode & 0o777).toBe(0o600);
  },
);
