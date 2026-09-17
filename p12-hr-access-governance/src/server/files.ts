import { lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function assertDirectoryPath(path: string): void {
  let current = resolve(path);
  for (;;) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error("Data directories must be real directories, not links");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function assertRegularFile(path: string): boolean {
  assertDirectoryPath(dirname(resolve(path)));
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
    throw new Error("Private files must be regular files without links");
  return stat !== undefined;
}

export function assertSqlitePath(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    assertRegularFile(`${path}${suffix}`);
}
