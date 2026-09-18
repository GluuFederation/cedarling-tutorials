import {
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
const temporaryRoots: string[] = [];

function createWorkspace(): {
  root: string;
  p1: string;
  identity: string;
} {
  const root = mkdtempSync(join(tmpdir(), "cedarling-p1-setup-"));
  const p1 = join(root, "p1-task-manager");
  const identity = join(root, "shared/identity-provider");
  mkdirSync(p1, { recursive: true });
  mkdirSync(identity, { recursive: true });
  writeFileSync(
    join(identity, ".env"),
    `IDP_ISSUER=http://idp.localhost:4000
P1_CLIENT_ID=p1-task-manager
P1_CLIENT_SECRET=${"s".repeat(43)}
P1_API_RESOURCE=http://p1.localhost:3000/api
P1_REDIRECT_URI=http://p1.localhost:3000/auth/callback
P1_POST_LOGOUT_REDIRECT_URI=http://p1.localhost:3000
P4_CLIENT_SECRET=must-survive
CUSTOM_SETTING=keep
`,
    { mode: 0o600 },
  );
  temporaryRoots.push(root);
  return { root, p1, identity };
}

function runSetup(p1: string) {
  return spawnSync(process.execPath, [setupScript], {
    cwd: p1,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("P1 environment setup", () => {
  test("copies the shared registration without changing another project", () => {
    const { p1, identity } = createWorkspace();
    const identityBefore = readFileSync(join(identity, ".env"), "utf8");
    const result = runSetup(p1);
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
    expect(p1Environment.P1_API_RESOURCE).toBe("http://p1.localhost:3000/api");
    expect(identityEnvironment.IDP_INTERACTION_SECRET).toBeUndefined();
    expect(identityEnvironment.P1_SESSION_ENCRYPTION_KEY).toBeUndefined();
    expect(identityEnvironment.P4_CLIENT_SECRET).toBe("must-survive");
    expect(identityEnvironment.CUSTOM_SETTING).toBe("keep");
    expect(readFileSync(join(identity, ".env"), "utf8")).toBe(identityBefore);
  });

  test("synchronizes a regenerated shared client secret", () => {
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
