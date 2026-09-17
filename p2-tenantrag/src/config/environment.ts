import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

type EnvironmentDependencies = Readonly<{
  exists: (path: string) => boolean;
  load: (path: string) => void;
}>;

const defaults: EnvironmentDependencies = {
  exists: existsSync,
  load: loadEnvFile,
};

/** Loads only this project's environment file; parent and sibling files are ignored. */
export function loadProjectEnvironment(
  projectRoot = process.cwd(),
  dependencies: EnvironmentDependencies = defaults,
): string | undefined {
  const environmentFile = resolve(projectRoot, ".env");
  if (!dependencies.exists(environmentFile)) return undefined;

  dependencies.load(environmentFile);
  return environmentFile;
}
