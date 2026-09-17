import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import {
  checkDependencies,
  issuerHealth,
} from "../../shared/dev-supervisor.mjs";

try {
  if (!existsSync(".env"))
    throw new Error("P11 .env is missing; run pnpm run setup.");
  loadEnvFile(".env");
  const databaseUrl = process.env.P11_DATABASE_URL;
  if (!databaseUrl) throw new Error("P11_DATABASE_URL is missing");
  const database = new URL(databaseUrl);
  const issuer = process.env.P11_ISSUER ?? "http://idp.localhost:4000";
  const issuerUrl = new URL(issuer);
  await checkDependencies([
    {
      kind: "tcp",
      name: "PostgreSQL",
      host: database.hostname,
      port: Number(database.port || 5432),
    },
    {
      kind: "http",
      name: "identity provider",
      url: `${issuerUrl.origin}/.well-known/openid-configuration`,
      validate: issuerHealth(issuer),
    },
  ]);
} catch (error) {
  console.error(
    `P11 native app cannot start: ${error instanceof Error ? error.message : "dependency check failed"}\nRun docker compose up --build for the complete PostgreSQL, identity-provider, and application stack.`,
  );
  process.exitCode = 1;
}
