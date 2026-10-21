import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, expect, test } from "vitest";
import { setupProject } from "../scripts/setup.ts";
import {
  containedDataDir,
  loadConfig,
} from "../src/server/config/environment.ts";
import { SchoolDatabase } from "../src/server/data/database.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("configuration keeps fixed authorization and validates local origins and ports", () => {
  const defaults = {
    P13_CLIENT_SECRET: "temporary-test-secret-at-least-32-characters",
  };
  expect(loadConfig({ ...defaults, P13_AUTHZ_MODE: "embedded" })).toEqual(
    loadConfig(defaults),
  );
  expect(() => loadConfig({ ...defaults, P13_HOST: "192.0.2.1" })).toThrow(
    "local or container",
  );
  expect(loadConfig({ ...defaults, P13_HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
  expect(() =>
    loadConfig({ ...defaults, P13_BASE_URL: "http://localhost:4001" }),
  ).toThrow("match");
  expect(() =>
    loadConfig({ ...defaults, P13_ISSUER: "https://remote.example" }),
  ).toThrow("local tutorial");
  expect(() =>
    loadConfig({
      ...defaults,
      P13_API_RESOURCE: "http://localhost:17013/other",
    }),
  ).toThrow("match");
});
test.each([17013, 4213])(
  "setup repairs stale ports and preserves learner state for registration %s",
  (port) => {
    mkdirSync(".local", { recursive: true });
    const root = mkdtempSync(resolve(".local/setup-test-"));
    roots.push(root);
    const identity = resolve(root, "identity.env");
    writeFileSync(
      identity,
      [
        "IDP_ISSUER=http://localhost:4400",
        "P13_CLIENT_ID=p13-client",
        "P13_CLIENT_SECRET=temporary-test-secret-at-least-32-characters",
        `P13_API_RESOURCE=http://localhost:${port}/api`,
        `P13_REDIRECT_URI=http://localhost:${port}/auth/callback`,
        `P13_POST_LOGOUT_REDIRECT_URI=http://localhost:${port}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    writeFileSync(
      resolve(root, ".env"),
      "P13_PORT=3013\nP13_IDP_PORT=4000\nP13_LOCAL_NOTE=keep\n",
    );
    setupProject(root, identity);
    const first = readFileSync(resolve(root, ".env"), "utf8");
    expect(parseEnv(first)).toMatchObject({
      P13_PORT: String(port),
      P13_IDP_PORT: "4400",
      P13_LOCAL_NOTE: "keep",
    });
    const databasePath = resolve(root, ".local/p13-data/school.sqlite");
    const before = new SchoolDatabase(databasePath, "http://localhost:4400");
    before.sql.exec(
      "UPDATE grades SET feedback='Learner change',version=2 WHERE id='grade-sam-1'",
    );
    before.changeFixture("withdraw-enrollment");
    before.close();
    setupProject(root, identity);
    expect(readFileSync(resolve(root, ".env"), "utf8")).toBe(first);
    const after = new SchoolDatabase(databasePath, "http://localhost:4400");
    expect(after.snapshot("talia", "grade-sam-1")).toMatchObject({
      grade: { feedback: "Learner change", version: 2 },
      enrollment: { state: "withdrawn", version: 2 },
    });
    after.close();
    writeFileSync(
      resolve(root, ".env"),
      first.replace(
        'P13_CLIENT_SECRET="temporary-test-secret-at-least-32-characters"',
        'P13_CLIENT_SECRET="conflicting-test-secret-at-least-32-characters"',
      ),
    );
    setupProject(root, identity);
    expect(readFileSync(resolve(root, ".env"), "utf8")).toContain(
      'P13_CLIENT_SECRET="temporary-test-secret-at-least-32-characters"',
    );
  },
);

test("setup and persisted data reject dangling symlinks and escaped paths", () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/setup-test-"));
  roots.push(root);
  symlinkSync(resolve(root, "missing"), resolve(root, ".env"));
  expect(() => setupProject(root, resolve(root, "identity.env"))).toThrow(
    "regular file",
  );
  mkdirSync(resolve(root, ".local"));
  symlinkSync(resolve(root, "missing-data"), resolve(root, ".local/data"));
  expect(() => containedDataDir(".local/data", root)).toThrow("symlinks");
  expect(() => containedDataDir("../outside", root)).toThrow("child");
});
