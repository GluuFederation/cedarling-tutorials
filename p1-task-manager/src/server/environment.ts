import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

type EnvironmentDependencies = Readonly<{
  exists: (path: string) => boolean;
  load: (path: string) => void;
}>;

const defaults: EnvironmentDependencies = {
  exists: existsSync,
  load: loadEnvFile,
};

export function loadProjectEnvironment(
  projectRoot = process.cwd(),
  dependencies: EnvironmentDependencies = defaults,
): string | undefined {
  const environmentFile = resolve(projectRoot, ".env");
  if (!dependencies.exists(environmentFile)) return undefined;

  dependencies.load(environmentFile);
  return environmentFile;
}
