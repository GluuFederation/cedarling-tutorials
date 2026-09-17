import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P3 setup", () => {
  it("creates and preserves .env content with private Unix permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "p3-setup-"));
    temporaryDirectories.push(root);
    const directory = join(root, "p3-mcp-capability-governance");
    const identityDirectory = join(root, "shared/identity-provider");
    await mkdir(directory, { recursive: true });
    await mkdir(identityDirectory, { recursive: true });
    const target = join(directory, ".env");
    const setupScript = resolve("scripts/setup.mjs");
    await writeFile(
      join(identityDirectory, ".env"),
      "IDP_ISSUER=http://idp.localhost:4000\nP3_CLIENT_ID=p3-client\nP3_MCP_RESOURCE=http://p3.localhost:3003/mcp\n",
    );

    await execute(process.execPath, [setupScript], { cwd: directory });
    expect(await readFile(target, "utf8")).toContain(
      'P3_CLIENT_ID="p3-client"',
    );
    if (process.platform !== "win32")
      expect((await stat(target)).mode & 0o777).toBe(0o600);

    await writeFile(
      target,
      "# learner setting\nP3_CLIENT_ID=stale\nP3_OPENROUTER_API_KEY=preserved\n",
    );
    if (process.platform !== "win32") await chmod(target, 0o664);
    await execute(process.execPath, [setupScript], { cwd: directory });

    const synchronized = await readFile(target, "utf8");
    expect(synchronized).toContain("# learner setting");
    expect(synchronized).toContain('P3_CLIENT_ID="p3-client"');
    expect(synchronized).toContain("P3_OPENROUTER_API_KEY=preserved");
    if (process.platform !== "win32")
      expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
});
