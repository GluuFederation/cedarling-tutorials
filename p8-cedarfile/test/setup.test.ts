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
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const setupScript = resolve(import.meta.dirname, "../scripts/setup.ts");

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "p8-setup-"));
  temporaryRoots.push(root);
  const project = resolve(root, "p8-cedarfile");
  const identity = resolve(root, "shared/identity-provider");
  mkdirSync(project, { recursive: true });
  mkdirSync(identity, { recursive: true });
  writeFileSync(
    resolve(identity, ".env"),
    `IDP_ISSUER=http://idp.localhost:4000
P8_CLIENT_ID=p8-cedarfile
P8_CLIENT_SECRET=${"p8".repeat(16)}
P8_API_RESOURCE=http://p8.localhost:3008/api
P8_REDIRECT_URI=http://p8.localhost:3008/auth/callback
P8_POST_LOGOUT_REDIRECT_URI=http://p8.localhost:3008
`,
    { mode: 0o600 },
  );
  const run = () =>
    spawnSync(process.execPath, ["--experimental-strip-types", setupScript], {
      cwd: project,
      encoding: "utf8",
    });
  return { project, run };
}

describe("P8 setup", () => {
  it("adds missing settings while preserving the complete existing file", () => {
    const { project, run } = fixture();
    const target = resolve(project, ".env");
    const original = "P8_LOCAL_NOTE=keep-me\n";
    writeFileSync(target, original, { mode: 0o644 });

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const firstContent = readFileSync(target, "utf8");
    const environment = parseEnv(firstContent);
    expect(firstContent.startsWith(original)).toBe(true);
    expect(environment.P8_LOCAL_NOTE).toBe("keep-me");
    expect(environment.P8_CLIENT_ID).toBe("p8-cedarfile");
    expect(environment.P8_SESSION_ENCRYPTION_KEY).toHaveLength(43);
    if (process.platform !== "win32")
      expect(statSync(target).mode & 0o777).toBe(0o600);

    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(firstContent);
    if (process.platform !== "win32")
      expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it("repairs a project registration mismatch", () => {
    const { project, run } = fixture();
    writeFileSync(resolve(project, ".env"), "P8_CLIENT_ID=wrong-client\n", {
      mode: 0o600,
    });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(
      parseEnv(readFileSync(resolve(project, ".env"), "utf8")),
    ).toMatchObject({ P8_CLIENT_ID: "p8-cedarfile" });
  });
});
