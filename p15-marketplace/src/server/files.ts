import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function assertDirectoryPath(path: string): void {
  let current = resolve(path);
  for (;;) {
    const status = lstatSync(current, { throwIfNoEntry: false });
    if (status && (!status.isDirectory() || status.isSymbolicLink()))
      throw new Error("Data paths must be directories without symbolic links");
    if (current === dirname(current)) return;
    current = dirname(current);
  }
}
export function assertRegularFile(path: string): boolean {
  assertDirectoryPath(dirname(path));
  const status = lstatSync(path, { throwIfNoEntry: false });
  if (
    status &&
    (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
  )
    throw new Error("Private state must be unlinked regular files");
  return status !== undefined;
}
export function assertSqlitePath(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    assertRegularFile(`${path}${suffix}`);
}
export function assertStatePaths(directory: string): void {
  assertDirectoryPath(directory);
  assertRegularFile(join(directory, "session-key"));
  assertSqlitePath(join(directory, "market.sqlite"));
}
