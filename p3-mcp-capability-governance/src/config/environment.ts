import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

/** Loads only P3's environment file, never a parent or sibling project file. */
export function loadProjectEnvironment(projectRoot = process.cwd()): void {
  const environmentFile = resolve(projectRoot, ".env");
  if (existsSync(environmentFile)) loadEnvFile(environmentFile);
}
