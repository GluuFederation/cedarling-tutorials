import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function temporaryRoot(prefix: string): string {
  return mkdtempSync(path.join(realpathSync(tmpdir()), prefix));
}
