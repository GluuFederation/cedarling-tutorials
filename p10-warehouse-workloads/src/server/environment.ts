import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export function loadLocalEnvironment(): void {
  // The supervisor already supplies only the credentials this service needs.
  if (process.env.P10_SUPERVISED === "1") return;
  const file = resolve(".env");
  if (existsSync(file)) loadEnvFile(file);
}
