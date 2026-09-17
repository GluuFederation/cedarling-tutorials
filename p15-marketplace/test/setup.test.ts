import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.ts";
import { Store } from "../src/server/database.ts";
import { prepareData } from "../src/server/prepare-data.ts";
import {
  decrypt,
  encrypt,
  randomToken,
  safeToken,
} from "../src/server/security.ts";

const directories: string[] = [];
function testDirectory() {
  mkdirSync(".local", { recursive: true });
  const directory = mkdtempSync(resolve(".local/test-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("rejects external listeners, mismatched ports, and escaping state", () => {
  expect(
    loadConfig({
      P15_CLIENT_SECRET: randomToken(),
      P15_HOST: "0.0.0.0",
    }).host,
  ).toBe("0.0.0.0");
  for (const changes of [
    { P15_HOST: "192.0.2.1" },
    { P15_BASE_URL: "http://evil.test:3015" },
    { P15_DATA_DIR: "../elsewhere" },
    { P15_PORT: "not-a-port" },
    { P15_PORT: "3016" },
  ])
    expect(() =>
      loadConfig({ P15_CLIENT_SECRET: randomToken(), ...changes }),
    ).toThrow();
});

it("prepares private state idempotently without overwriting learner data", () => {
  const directory = testDirectory();
  prepareData(directory);
  const key = readFileSync(join(directory, "session-key"), "utf8");
  if (process.platform !== "win32")
    expect(statSync(join(directory, "session-key")).mode & 0o777).toBe(0o600);
  const first = new Store(join(directory, "market.sqlite"));
  first.db
    .prepare(
      "UPDATE refunds SET state='requested',version=9 WHERE id='refund-bao-001'",
    )
    .run();
  first.close();
  prepareData(directory);
  const next = new Store(join(directory, "market.sqlite"));
  expect(next.refund("refund-bao-001")).toMatchObject({
    state: "requested",
    version: 9,
  });
  next.close();
  expect(readFileSync(join(directory, "session-key"), "utf8")).toBe(key);
  writeFileSync(join(directory, "session-key"), "invalid");
  expect(() => prepareData(directory)).toThrow("Invalid private state");
});

it("repairs shared registration values and preserves project settings", () => {
  const directory = testDirectory();
  const project = join(directory, "project");
  const identity = join(directory, "shared/identity-provider");
  mkdirSync(project);
  mkdirSync(identity, { recursive: true });
  const secret = randomToken();
  writeFileSync(
    join(identity, ".env"),
    [
      "IDP_ISSUER=http://idp.localhost:4000",
      "P15_CLIENT_ID=p15-client",
      `P15_CLIENT_SECRET=${secret}`,
      "P15_API_RESOURCE=http://p15.localhost:3015/api",
      "P15_REDIRECT_URI=http://p15.localhost:3015/auth/callback",
      "P15_POST_LOGOUT_REDIRECT_URI=http://p15.localhost:3015",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(project, ".env"),
    `P15_CLIENT_SECRET=${randomToken()}\nP15_LOCAL_NOTE=keep\n`,
  );
  execFileSync(process.execPath, [resolve("scripts/setup.ts")], {
    cwd: project,
    stdio: "pipe",
  });
  const configured = readFileSync(join(project, ".env"), "utf8");
  expect(configured).toContain(`P15_CLIENT_SECRET="${secret}"`);
  expect(configured).toContain("P15_LOCAL_NOTE=keep");
});

it("refuses linked state paths before opening the database", () => {
  const directory = testDirectory();
  const target = join(directory, "target");
  mkdirSync(target);
  symlinkSync(target, join(directory, "link"));
  expect(() => prepareData(join(directory, "link"))).toThrow("symbolic links");
  expect(existsSync(join(target, "market.sqlite"))).toBe(false);
});

it("encrypts server-side tokens and compares only exact opaque values", () => {
  const token = randomToken();
  const key = Buffer.from(randomToken(), "hex");
  const sealed = encrypt("token secret", key);
  expect(decrypt(sealed, key)).toBe("token secret");
  expect(() => decrypt(sealed, Buffer.alloc(32))).toThrow();
  expect(safeToken(token, token)).toBe(true);
  expect(safeToken("short", token)).toBe(false);
});
