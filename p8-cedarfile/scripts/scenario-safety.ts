export function parseRunningServices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function assertScenarioIdle(output: string): void {
  const services = parseRunningServices(output);
  if (services.length === 0) return;
  throw new Error(
    `Stop the P8 Compose services before running the permissive scenario: ${services.join(", ")}`,
  );
}
