import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readSources } from "./source.mjs";

const commit = "a".repeat(40);
const blob = Buffer.from([0, 10, 255, 13, 0]);
const oid = createHash("sha1")
  .update(`blob ${blob.length}\0`)
  .update(blob)
  .digest("hex");
const tree = (mode = "100755", size = blob.length) =>
  Buffer.from(`${mode} blob ${oid} ${size}\tapp/[id].js\0`);
const batch = () =>
  Buffer.concat([
    Buffer.from(`${oid} blob ${blob.length}\n`),
    blob,
    Buffer.from("\n"),
  ]);
const execute = (listing, content) => (_command, args) =>
  args.includes("ls-tree") ? listing : content;

test("source snapshots preserve binary bytes, modes, literal paths, and missing entries", () => {
  const read = readSources("/fixture", [commit], ["app/[id].js"], {
    execute: execute(tree(), batch()),
  });
  assert.deepEqual(read(commit, "app/[id].js"), { bytes: blob, mode: 0o755 });
  assert.equal(read(commit, "missing.js"), null);
});

test("source snapshots reject non-regular and oversized files before reading blobs", () => {
  for (const listing of [tree("120000"), tree("100644", 2 * 1024 * 1024 + 1)]) {
    assert.throws(
      () =>
        readSources("/fixture", [commit], ["app/[id].js"], {
          execute: execute(listing, batch()),
        }),
      /regular file|exceeds 2 MiB/,
    );
  }
});

test("source snapshots reject truncated, missing, corrupt, and unsolicited blob responses", () => {
  for (const content of [
    batch().subarray(0, -2),
    Buffer.from(`${oid} missing\n`),
    Buffer.concat([
      Buffer.from(`${oid} blob ${blob.length}\n`),
      Buffer.alloc(blob.length),
      Buffer.from("\n"),
    ]),
    Buffer.concat([batch(), Buffer.from("extra")]),
  ]) {
    assert.throws(
      () =>
        readSources("/fixture", [commit], ["app/[id].js"], {
          execute: execute(tree(), content),
        }),
      /source blob/i,
    );
  }
});

test("each invocation reads its own source snapshot", () => {
  const first = readSources("/fixture", [commit], ["app/[id].js"], {
    execute: execute(tree(), batch()),
  });
  const second = readSources("/fixture", [commit], ["app/[id].js"], {
    execute: execute(Buffer.alloc(0), Buffer.alloc(0)),
  });
  assert.deepEqual(first(commit, "app/[id].js").bytes, blob);
  assert.equal(second(commit, "app/[id].js"), null);
});

test("large source sets remain available after cache eviction", () => {
  const files = Array.from({ length: 5 }, (_, index) => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, index);
    const oid = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    return { path: `app/file${index}.bin`, oid, bytes };
  });
  const objects = new Map(files.map((file) => [file.oid, file]));
  const read = readSources(
    "/fixture",
    [commit],
    files.map((file) => file.path),
    {
      execute: (_command, args, options) =>
        args.includes("ls-tree")
          ? Buffer.from(
              files
                .map(
                  (file) =>
                    `100644 blob ${file.oid} ${file.bytes.length}\t${file.path}\0`,
                )
                .join(""),
            )
          : Buffer.concat(
              options.input
                .trim()
                .split("\n")
                .map((oid) => {
                  const file = objects.get(oid);
                  return Buffer.concat([
                    Buffer.from(`${oid} blob ${file.bytes.length}\n`),
                    file.bytes,
                    Buffer.from("\n"),
                  ]);
                }),
            ),
    },
  );
  for (const file of [...files, files[0]])
    assert.deepEqual(read(commit, file.path).bytes, file.bytes);
});

test("source sets exceeding Windows' argument limit retain every literal path", () => {
  const paths = Array.from(
    { length: 256 },
    (_, index) => `app/${"x".repeat(180)}-${index}.js`,
  );
  const read = readSources("/fixture", [commit], paths, {
    execute: (_command, args) => {
      assert.ok(
        args.join(" ").length < 32767,
        "Windows command-line limit exceeded",
      );
      if (!args.includes("ls-tree")) return batch();
      return Buffer.from(
        args
          .slice(args.indexOf("--") + 1)
          .map((path) => `100644 blob ${oid} ${blob.length}\t${path}\0`)
          .join(""),
      );
    },
  });
  for (const path of paths) assert.deepEqual(read(commit, path).bytes, blob);
  assert.throws(() => readSources("/fixture", [commit], []), /No source paths/);
});
