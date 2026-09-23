// Verifies the cross-platform tutorial hostname management helper.

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkWindowsHosts,
  installEntries,
  removeEntries,
  run,
  tutorialHosts,
  windowsHostsPath,
} from "../../host";

test("defines the identity provider and all project hostnames", () => {
  assert.deepEqual(tutorialHosts, [
    "idp.localhost",
    ...Array.from({ length: 15 }, (_, index) => `p${index + 1}.localhost`),
  ]);
});

test("installs one idempotent managed block and preserves CRLF", () => {
  const original = "127.0.0.1 localhost\r\n# keep\r\n";
  const installed = installEntries(original);
  assert.match(installed, /# keep\r\n\r\n# BEGIN cedarling-tutorials/u);
  assert.match(installed, /127\.0\.0\.1 p15\.localhost\r\n/u);
  assert.equal(installEntries(installed), installed);
});

test("removes only the managed block", () => {
  const original = "127.0.0.1 localhost\n# keep\n";
  assert.equal(removeEntries(installEntries(original)), original);
  assert.equal(removeEntries(original), original);
});

test("replaces stale managed entries and rejects unsafe conflicts", () => {
  const stale = [
    "# BEGIN cedarling-tutorials",
    "127.0.0.1 idp.localhost",
    "# END cedarling-tutorials",
    "",
  ].join("\n");
  assert.match(installEntries(stale), /127\.0\.0\.1 p15\.localhost/u);
  assert.throws(
    () => installEntries("192.0.2.1 p4.localhost\n"),
    /p4\.localhost already maps to 192\.0\.2\.1/u,
  );
  assert.throws(
    () => installEntries("# BEGIN cedarling-tutorials\n"),
    /hosts block is incomplete/u,
  );
});

test("uses the documented Windows hosts path", () => {
  assert.equal(
    windowsHostsPath({ SystemRoot: "C:\\Windows" }),
    "C:\\Windows\\System32\\drivers\\etc\\hosts",
  );
});

test("accepts only IPv4 loopback answers", async () => {
  let calls = 0;
  await checkWindowsHosts(async () => {
    calls += 1;
    return [{ address: "127.0.0.1", family: 4 }];
  });
  assert.equal(calls, 16);

  await assert.rejects(
    checkWindowsHosts(async (host) => {
      if (host === "p4.localhost") throw new Error("ENOTFOUND");
      return [{ address: "127.0.0.1", family: 4 }];
    }),
    /p4\.localhost/u,
  );
});

test("does not require mappings outside Windows", async () => {
  const messages = [];
  await run("check", {
    platform: "linux",
    log: (message) => messages.push(message),
  });
  assert.deepEqual(messages, [
    "Tutorial hostname compatibility setup is not required.",
  ]);
});
