export type Environment = Readonly<Record<string, string>>;

export type MergedEnvironment = Readonly<{
  text: string;
  environment: Environment;
  synchronizedKeys: string[];
}>;

export function mergeProjectEnvironment(
  currentText: string,
  values: Readonly<{
    managed: Environment;
    defaults?: Environment;
  }>,
): MergedEnvironment;

export function readProjectEnvironment(target: string): Readonly<{
  exists: boolean;
  text: string;
  environment: Environment;
}>;

export function writePrivateEnvironment(target: string, text: string): boolean;
