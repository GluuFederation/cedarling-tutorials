import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const setupScript = fileURLToPath(
  new URL("../scripts/setup.mjs", import.meta.url),
);
const policyStoreSource = fileURLToPath(
  new URL("../policy-store", import.meta.url),
);
const temporaryRoots: string[] = [];

function createWorkspace(): {
  root: string;
  p1: string;
  identity: string;
} {
  const root = mkdtempSync(join(tmpdir(), "cedarling-p1-setup-"));
  const p1 = join(root, "p1-task-manager");
  const identity = join(p1, ".local/idp");
  mkdirSync(p1, { recursive: true });
  mkdirSync(identity, { recursive: true });
  cpSync(policyStoreSource, join(p1, "policy-store"), { recursive: true });
  writeFileSync(
    join(identity, ".env"),
    `IDP_PROJECT=P1
IDP_HOST=127.0.0.1
IDP_PORT=18001
IDP_ISSUER=http://localhost:18001
P1_CLIENT_ID=p1-task-manager
P1_CLIENT_SECRET=${"s".repeat(43)}
P1_API_RESOURCE=http://localhost:17001/api
P1_REDIRECT_URI=http://localhost:17001/auth/callback
P1_POST_LOGOUT_REDIRECT_URI=http://localhost:17001
P4_CLIENT_SECRET=must-survive
CUSTOM_SETTING=keep
`,
    { mode: 0o600 },
  );
  temporaryRoots.push(root);
  return { root, p1, identity };
}

function runSetup(p1: string, timeZone?: string) {
  return spawnSync(process.execPath, [setupScript], {
    cwd: p1,
    encoding: "utf8",
    env: timeZone ? { ...process.env, TZ: timeZone } : process.env,
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("P1 environment setup", () => {
  test("synchronizes the listen port without replacing local state settings", () => {
    const { p1 } = createWorkspace();
    expect(runSetup(p1).status).toBe(0);
    const target = join(p1, ".env");
    const initial = readFileSync(target, "utf8");
    const before = parseEnv(initial);
    writeFileSync(target, initial.replace(/P1_PORT=.*$/m, "P1_PORT=3000"));
    const result = runSetup(p1);
    expect(result.status, result.stderr).toBe(0);
    const after = parseEnv(readFileSync(target, "utf8"));
    expect(after.P1_PORT).toBe("17001");
    expect(after.P1_DATA_DIR).toBe(before.P1_DATA_DIR);
    expect(after.P1_SESSION_ENCRYPTION_KEY).toBe(
      before.P1_SESSION_ENCRYPTION_KEY,
    );
    expect(after.P1_CLIENT_SECRET).toBe(before.P1_CLIENT_SECRET);
    const synchronized = readFileSync(target, "utf8");
    expect(runSetup(p1).status).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(synchronized);
  });

  test("rejects a different issuer without replacing the application environment", () => {
    const { p1, identity } = createWorkspace();
    expect(runSetup(p1).status).toBe(0);
    const before = readFileSync(join(p1, ".env"), "utf8");
    const identityPath = join(identity, ".env");
    writeFileSync(
      identityPath,
      readFileSync(identityPath, "utf8").replace(
        "IDP_ISSUER=http://localhost:18001",
        "IDP_ISSUER=http://localhost:19001",
      ),
    );
    const result = runSetup(p1);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("P1 policies require issuer");
    expect(readFileSync(join(p1, ".env"), "utf8")).toBe(before);
  });

  test("copies the project registration without changing another project", () => {
    const { p1, identity } = createWorkspace();
    const identityBefore = readFileSync(join(identity, ".env"), "utf8");
    const result = runSetup(p1, "UTC");
    expect(result.status, result.stderr).toBe(0);

    const p1Environment = parseEnv(readFileSync(join(p1, ".env"), "utf8"));
    const identityEnvironment = parseEnv(
      readFileSync(join(identity, ".env"), "utf8"),
    );

    expect(p1Environment.P1_CLIENT_SECRET).toBe("s".repeat(43));
    expect(identityEnvironment.P1_CLIENT_SECRET).toBe(
      p1Environment.P1_CLIENT_SECRET,
    );
    expect(identityEnvironment.IDP_ISSUER).toBe(p1Environment.P1_ISSUER);
    expect(identityEnvironment.P1_API_RESOURCE).toBe(
      p1Environment.P1_API_RESOURCE,
    );
    expect(p1Environment.P1_API_RESOURCE).toBe("http://localhost:17001/api");
    expect(identityEnvironment.IDP_INTERACTION_SECRET).toBeUndefined();
    expect(identityEnvironment.P1_SESSION_ENCRYPTION_KEY).toBeUndefined();
    expect(identityEnvironment.P4_CLIENT_SECRET).toBe("must-survive");
    expect(identityEnvironment.CUSTOM_SETTING).toBe("keep");
    expect(readFileSync(join(identity, ".env"), "utf8")).toBe(identityBefore);
    const firstArchive = readFileSync(join(p1, ".local/policy-store.cjar"));
    expect(firstArchive).not.toHaveLength(0);
    expect(runSetup(p1, "Africa/Porto-Novo").status).toBe(0);
    expect(readFileSync(join(p1, ".local/policy-store.cjar"))).toEqual(
      firstArchive,
    );
  });

  test("synchronizes a regenerated project client secret", () => {
    const { p1, identity } = createWorkspace();
    expect(runSetup(p1).status).toBe(0);
    const identityPath = join(identity, ".env");
    const content = readFileSync(identityPath, "utf8").replace(
      /^P1_CLIENT_SECRET=.*$/m,
      `P1_CLIENT_SECRET=${"x".repeat(43)}`,
    );
    writeFileSync(identityPath, content, { mode: 0o600 });

    const result = runSetup(p1);
    expect(result.status, result.stderr).toBe(0);
    const project = parseEnv(readFileSync(join(p1, ".env"), "utf8"));
    expect(project.P1_CLIENT_SECRET).toBe("x".repeat(43));
  });
});
