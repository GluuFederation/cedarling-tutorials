import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  hardenSources,
  installBrowser,
  installPhase,
} from "./setup-browser.mjs";

test("Ubuntu sources use official HTTPS endpoints and retain signing configuration", () => {
  const source =
    "URIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  assert.equal(
    hardenSources(source),
    source.replace(
      "http://azure.archive.ubuntu.com",
      "https://archive.ubuntu.com",
    ),
  );
  assert.equal(
    hardenSources("deb http://security.ubuntu.com/ubuntu noble-security main"),
    "deb https://security.ubuntu.com/ubuntu noble-security main",
  );
  assert.equal(
    hardenSources("URIs: https://packages.microsoft.com/repos/code"),
    "URIs: https://packages.microsoft.com/repos/code",
  );
});

test(
  "the installer enforces real process deadlines and cancellation",
  { skip: process.platform !== "linux", timeout: 15_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "ci-installer-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cli = join(root, "fixture.mjs");
    await writeFile(cli, "setInterval(() => {}, 1000);\n");
    await assert.rejects(installPhase("browser", 1000, { cli }), /timed out/);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(
        installPhase("browser", 10_000, { cli, signal: controller.signal }),
        /cancelled/,
      );
    } finally {
      clearTimeout(timer);
    }
  },
);

test("browser setup retries a transport failure once and keeps successful dependency setup", async () => {
  const calls = [];
  let downloads = 0;
  await installBrowser({
    install: async (phase) => {
      calls.push(phase);
      if (phase === "browser" && ++downloads === 1)
        throw new Error("ECONNRESET");
    },
  });
  assert.deepEqual(calls, ["dependencies", "browser", "browser"]);
});

test("browser setup fails after its single network retry", async () => {
  let calls = 0;
  await assert.rejects(
    installBrowser({
      install: async () => {
        calls++;
        throw new Error("Temporary failure resolving archive.ubuntu.com");
      },
    }),
    /Temporary failure/,
  );
  assert.equal(calls, 2);
});

test("browser setup does not retry verification, package, timeout, or cancellation failures", async () => {
  for (const message of [
    "NO_PUBKEY; Failed to fetch",
    "Hash Sum mismatch",
    "dpkg was interrupted",
    "Unable to locate package",
    "certificate verification failed",
    "setup timed out",
    "setup cancelled",
    "unrecognized failure",
  ]) {
    let calls = 0;
    await assert.rejects(
      installBrowser({
        install: async () => {
          calls++;
          throw new Error(message);
        },
      }),
      new RegExp(message),
    );
    assert.equal(calls, 1, message);
  }
});

test("setup reports each phase and a finite remaining attempt budget", async () => {
  const reports = [];
  await installBrowser({
    install: async (_phase, budget) =>
      assert.ok(budget > 0 && budget <= 180_000),
    report: (row) => reports.push(row),
  });
  assert.deepEqual(
    reports.map((row) => row.phase),
    ["dependencies", "browser"],
  );
  assert.ok(
    reports.every(
      (row) =>
        row.attempt === 1 && row.result === "success" && row.seconds >= 0,
    ),
  );
});
