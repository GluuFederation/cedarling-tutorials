export function buildPolicyStore(options: {
  readonly projectRoot: string;
  readonly dependencyRoot: string;
}): Promise<{
  readonly outputPath: string;
  readonly version: string;
  readonly sha256: string;
}>;
