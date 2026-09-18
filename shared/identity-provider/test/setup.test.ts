import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../scripts/project-environment.mjs";

const temporaryDirectories: string[] = [];
const setupScript = resolve(import.meta.dirname, "../scripts/setup.mjs");

function temporaryDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), "cedarling-idp-setup-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("identity-provider setup", () => {
  it("adds missing application settings while preserving existing values", () => {
    const directory = temporaryDirectory();
    const target = resolve(directory, ".env");
    const existingSecret = "existing-p1-secret-value-123456789";
    writeFileSync(
      target,
      `IDP_PORT=4400\nP1_CLIENT_SECRET=${existingSecret}\nCUSTOM_SETTING=keep\n`,
    );

    execFileSync(process.execPath, [setupScript], { cwd: directory });

    const firstContent = readFileSync(target, "utf8");
    const environment = parseEnv(firstContent);
    expect(environment).toMatchObject({
      IDP_PORT: "4400",
      P1_CLIENT_SECRET: existingSecret,
      CUSTOM_SETTING: "keep",
      P3_CLIENT_ID: "p3-mcp-capability-governance-cli",
      P3_MCP_RESOURCE: "http://p3.localhost:3003/mcp",
      P4_CLIENT_ID: "p4-editorial-publishing",
      P4_API_RESOURCE: "http://p4.localhost:3004/api",
      P5_CLIENT_ID: "p5-dataguard",
      P5_API_RESOURCE: "http://p5.localhost:3005/api",
      P6_CLIENT_ID: "p6-field-inspection",
      P6_API_RESOURCE: "http://p6.localhost:3006/api",
      P7_CLIENT_ID: "p7-collaborative-docs",
      P7_API_RESOURCE: "http://p7.localhost:3007/api",
      P8_CLIENT_ID: "p8-cedarfile",
      P8_API_RESOURCE: "http://p8.localhost:3008/api",
      P9_CLIENT_ID: "p9-cedarrealtime",
      P9_API_RESOURCE: "http://p9.localhost:3009/api",
      P10_TRANSFER_PLANNER_CLIENT_ID: "p10-transfer-planner",
      P10_WAREHOUSE_NORTH_CLIENT_ID: "p10-warehouse-north",
      P10_WAREHOUSE_SOUTH_CLIENT_ID: "p10-warehouse-south",
      P10_INVENTORY_AUDITOR_CLIENT_ID: "p10-inventory-auditor",
      P10_API_RESOURCE: "http://p10.localhost:3010/api",
      P11_CLIENT_ID: "p11-saas-workspace",
      P11_API_RESOURCE: "http://p11.localhost:3011/api",
      P12_CLIENT_ID: "p12-hr-access-governance",
      P12_API_RESOURCE: "http://p12.localhost:3012/api",
      P13_CLIENT_ID: "p13-student-records",
      P13_API_RESOURCE: "http://p13.localhost:3013/api",
      P14_CLIENT_ID: "p14-ai-scheduling-assistant",
      P14_API_RESOURCE: "http://p14.localhost:3014/api",
      P15_CLIENT_ID: "p15-marketplace",
      P15_API_RESOURCE: "http://p15.localhost:3015/api",
      IDP_PROFILE: "default",
    });
    expect(environment.P4_CLIENT_SECRET).toHaveLength(43);
    expect(environment.P5_CLIENT_SECRET).toHaveLength(43);
    expect(environment.P6_CLIENT_SECRET).toHaveLength(43);
    expect(environment.P7_CLIENT_SECRET).toHaveLength(43);
    expect(environment.P8_CLIENT_SECRET).toHaveLength(43);
    expect(environment.P9_CLIENT_SECRET).toHaveLength(43);
    for (const prefix of [
      "P10_TRANSFER_PLANNER",
      "P10_WAREHOUSE_NORTH",
      "P10_WAREHOUSE_SOUTH",
      "P10_INVENTORY_AUDITOR",
    ]) {
      expect(environment[`${prefix}_CLIENT_SECRET`]).toHaveLength(43);
    }
    expect(environment.P11_CLIENT_SECRET).toHaveLength(43);
    for (const prefix of ["P12", "P13", "P14", "P15"]) {
      expect(environment[`${prefix}_CLIENT_SECRET`]).toHaveLength(43);
    }
    if (process.platform !== "win32")
      expect(statSync(target).mode & 0o777).toBe(0o600);

    execFileSync(process.execPath, [setupScript], { cwd: directory });
    expect(readFileSync(target, "utf8")).toBe(firstContent);
  });

  it("synchronizes the managed P4 client ID and remains idempotent", () => {
    const directory = temporaryDirectory();
    const target = resolve(directory, ".env");
    const secret = "keep-this-p4-secret-123456789";
    writeFileSync(
      target,
      `P4_CLIENT_ID=stale-p4-client\nP4_CLIENT_SECRET=${secret}\nCUSTOM_SETTING=keep\n`,
    );

    execFileSync(process.execPath, [setupScript], { cwd: directory });

    const firstContent = readFileSync(target, "utf8");
    expect(parseEnv(firstContent)).toMatchObject({
      P4_CLIENT_ID: "p4-editorial-publishing",
      P4_CLIENT_SECRET: secret,
      CUSTOM_SETTING: "keep",
    });
    execFileSync(process.execPath, [setupScript], { cwd: directory });
    expect(readFileSync(target, "utf8")).toBe(firstContent);
  });

  it("synchronizes only IdP-owned project settings", () => {
    const merged = mergeProjectEnvironment(
      "# local settings\r\nP12_CLIENT_SECRET=stale\r\nP12_DATA_DIR=custom-data\r\n",
      {
        managed: { P12_CLIENT_SECRET: "current" },
        defaults: {
          P12_DATA_DIR: ".local/p12-data",
          P12_SESSION_SECRET: "local-session",
        },
      },
    );
    expect(merged.text).toBe(
      '# local settings\r\nP12_CLIENT_SECRET="current"\r\nP12_DATA_DIR=custom-data\r\nP12_SESSION_SECRET="local-session"\r\n',
    );
    expect(merged.environment).toMatchObject({
      P12_CLIENT_SECRET: "current",
      P12_DATA_DIR: "custom-data",
      P12_SESSION_SECRET: "local-session",
    });
    expect(merged.synchronizedKeys).toEqual([
      "P12_CLIENT_SECRET",
      "P12_SESSION_SECRET",
    ]);
  });

  it("rejects duplicate keys and unsafe project environment files", () => {
    expect(() =>
      mergeProjectEnvironment("VALUE=one\nVALUE=two\n", {
        managed: { VALUE: "current" },
      }),
    ).toThrow("Duplicate environment key: VALUE");

    const directory = temporaryDirectory();
    const target = resolve(directory, ".env");
    writePrivateEnvironment(target, 'VALUE="current"\n');
    expect(readProjectEnvironment(target).environment.VALUE).toBe("current");
    expect(writePrivateEnvironment(target, 'VALUE="current"\n')).toBe(false);
  });
});
