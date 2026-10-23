// Reads only the declared immutable Git files for one helper invocation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const maxFileBytes = 2 * 1024 * 1024;
const batchBytes = 8 * 1024 * 1024;

export function readSources(
  root,
  commits,
  paths,
  { execute = execFileSync } = {},
) {
  const trees = new Map();
  const objects = new Map();
  const requested = [...new Set(paths)];
  if (!requested.length) throw new Error("No source paths requested");
  const git = (args, input) =>
    execute("git", ["--literal-pathspecs", "-C", root, ...args], {
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  for (const commit of new Set(commits)) {
    const entries = new Map();
    // Keep argument lists within Windows' command-line limit too.
    const chunks = [];
    let chunk = [];
    let argumentBytes = 0;
    for (const path of requested) {
      if (chunk.length && argumentBytes + path.length + 1 > 8192) {
        chunks.push(chunk);
        chunk = [];
        argumentBytes = 0;
      }
      chunk.push(path);
      argumentBytes += path.length + 1;
    }
    chunks.push(chunk);
    for (const paths of chunks) {
      const listing = git([
        "ls-tree",
        "-r",
        "-l",
        "-z",
        commit,
        "--",
        ...paths,
      ]).toString("utf8");
      for (const line of listing.split("\0").filter(Boolean)) {
        const match =
          /^(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t([^\0]+)$/.exec(line);
        if (!match) throw new Error("Source must be a regular file");
        const [, mode, oid, length, path] = match;
        const size = Number(length);
        if (size > maxFileBytes)
          throw new Error(`Source file exceeds 2 MiB: ${path}`);
        entries.set(path, { oid, mode: mode === "100755" ? 0o755 : 0o644 });
        objects.set(oid, size);
      }
    }
    trees.set(commit, entries);
  }
  const blobs = new Map();
  let cachedBytes = 0;
  function load(batch) {
    if (!batch.length) return;
    const output = git(
      ["cat-file", "--batch"],
      `${batch.map(([oid]) => oid).join("\n")}\n`,
    );
    let offset = 0;
    for (const [oid, size] of batch) {
      const end = output.indexOf(10, offset);
      const header = output.subarray(offset, end).toString("ascii");
      if (
        end < offset ||
        header !== `${oid} blob ${size}` ||
        output.length < end + size + 2
      )
        throw new Error("Invalid or truncated source blob response");
      const bytes = output.subarray(end + 1, end + 1 + size);
      const actual = createHash("sha1")
        .update(`blob ${size}\0`)
        .update(bytes)
        .digest("hex");
      offset = end + size + 2;
      if (output[offset - 1] !== 10 || actual !== oid)
        throw new Error("Corrupt source blob response");
      while (cachedBytes + size > batchBytes && blobs.size) {
        const oldest = blobs.keys().next().value;
        cachedBytes -= blobs.get(oldest).length;
        blobs.delete(oldest);
      }
      blobs.set(oid, bytes);
      cachedBytes += size;
    }
    if (offset !== output.length)
      throw new Error("Unexpected source blob response");
  }
  // Small source sets fit in one batch. Larger sets are read on demand so a
  // future project's manifest cannot turn the snapshot into an unbounded cache.
  if (
    objects.size <= 256 &&
    [...objects.values()].reduce((sum, size) => sum + size, 0) <= batchBytes
  )
    load([...objects]);
  return (commit, path) => {
    const entry = trees.get(commit)?.get(path);
    if (!entry) return null;
    if (!blobs.has(entry.oid)) load([[entry.oid, objects.get(entry.oid)]]);
    return { bytes: blobs.get(entry.oid), mode: entry.mode };
  };
}
