import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
const project = resolve(import.meta.dirname, "..");
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("native preflight explains the missing corpus without invoking providers", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "p2-preflight-"));
  directories.push(directory);
  const result = spawnSync(
    process.execPath,
    [
      resolve(project, "node_modules/tsx/dist/cli.mjs"),
      resolve(project, "scripts/preflight.ts"),
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        P2_PROJECT_ROOT: directory,
        P2_VOYAGE_API_KEY: "test-voyage",
        P2_OPENROUTER_API_KEY: "test-openrouter",
      },
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("P2 corpus is missing");
  expect(result.stderr).toContain("setup consumes provider quota");
});

test("local preparation repairs networking without provider keys or corpus generation", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "p2-prepare-"));
  directories.push(directory);
  cpSync(resolve(project, "policy-store"), resolve(directory, "policy-store"), {
    recursive: true,
  });
  writeFileSync(
    resolve(directory, ".env"),
    "P2_PORT=3002\nP2_BASE_URL=http://p2.localhost:3002\nP2_ISSUER=http://idp.localhost:4000\nCUSTOM_SETTING=keep\n",
  );
  const run = () =>
    spawnSync(
      process.execPath,
      [
        resolve(project, "node_modules/tsx/dist/cli.mjs"),
        resolve(project, "scripts/prepare.ts"),
      ],
      { cwd: directory, encoding: "utf8" },
    );
  const first = run();
  expect(first.status, first.stderr).toBe(0);
  const content = readFileSync(resolve(directory, ".env"), "utf8");
  expect(parseEnv(content)).toMatchObject({
    P2_PORT: "17002",
    P2_BASE_URL: "http://localhost:17002",
    P2_ISSUER: "http://localhost:18002",
    CUSTOM_SETTING: "keep",
  });
  const identity = readFileSync(resolve(directory, ".local/idp/.env"), "utf8");
  const archive = readFileSync(resolve(directory, ".local/policy-store.cjar"));
  expect(archive.length).toBeGreaterThan(0);
  const repeated = run();
  expect(repeated.status, repeated.stderr).toBe(0);
  expect(readFileSync(resolve(directory, ".env"), "utf8")).toBe(content);
  expect(readFileSync(resolve(directory, ".local/idp/.env"), "utf8")).toBe(
    identity,
  );
  expect(readFileSync(resolve(directory, ".local/policy-store.cjar"))).toEqual(
    archive,
  );
});
