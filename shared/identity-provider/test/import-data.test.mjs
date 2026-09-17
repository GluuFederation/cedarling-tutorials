import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "tutorial-import-"));
  const source = resolve(root, "source");
  const destination = resolve(root, "destination");
  mkdirSync(source);
  mkdirSync(destination);
  const run = () =>
    spawnSync(process.execPath, [resolve("scripts/import-data.mjs")], {
      env: {
        ...process.env,
        IMPORT_SOURCE: source,
        IMPORT_DESTINATION: destination,
      },
      encoding: "utf8",
    });
  return { root, source, destination, run };
}

test("copies regular offline state without changing its source", () => {
  const state = fixture();
  try {
    mkdirSync(resolve(state.source, "content"));
    writeFileSync(resolve(state.source, "app.sqlite"), "database");
    writeFileSync(resolve(state.source, "content", "file.bin"), "payload");
    const result = state.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(resolve(state.source, "app.sqlite"), "utf8"),
      "database",
    );
    assert.equal(
      readFileSync(resolve(state.destination, "app.sqlite"), "utf8"),
      "database",
    );
    assert.equal(
      readFileSync(resolve(state.destination, "content", "file.bin"), "utf8"),
      "payload",
    );
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});

test("refuses a non-empty destination", () => {
  const state = fixture();
  try {
    writeFileSync(resolve(state.source, "app.sqlite"), "source");
    writeFileSync(resolve(state.destination, "app.sqlite"), "existing");
    const result = state.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Destination volume is not empty/u);
    assert.equal(
      readFileSync(resolve(state.destination, "app.sqlite"), "utf8"),
      "existing",
    );
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});

test.each([
  [
    "symbolic link",
    (source) => symlinkSync("missing", resolve(source, "state")),
  ],
  [
    "hard link",
    (source) => {
      writeFileSync(resolve(source, "state"), "data");
      linkSync(resolve(source, "state"), resolve(source, "alias"));
    },
  ],
  [
    "SQLite sidecar",
    (source) => writeFileSync(resolve(source, "app.sqlite-wal"), "pending"),
  ],
])("refuses %s input", (_name, arrange) => {
  const state = fixture();
  try {
    arrange(state.source);
    assert.notEqual(state.run().status, 0);
  } finally {
    rmSync(state.root, { recursive: true, force: true });
  }
});
