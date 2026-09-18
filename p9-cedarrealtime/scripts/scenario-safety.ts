export function assertScenarioIdle(services: string): void {
  if (services.trim()) {
    throw new Error(
      "P9 scenario refuses to replace a running learner Compose session",
    );
  }
}
