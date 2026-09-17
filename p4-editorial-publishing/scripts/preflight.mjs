import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import {
  checkDependencies,
  issuerHealth,
} from "../../shared/dev-supervisor.mjs";

if (existsSync(".env")) loadEnvFile(".env");
else if (!process.env.P4_CLIENT_SECRET)
  throw new Error("P4 environment is missing; run pnpm run setup.");
if (!existsSync(".next/BUILD_ID"))
  throw new Error("P4 production build is missing; run pnpm build.");
const issuer = process.env.P4_ISSUER ?? "http://idp.localhost:4000";
await checkDependencies([
  {
    kind: "http",
    name: "identity provider",
    url: `${new URL(issuer).origin}/.well-known/openid-configuration`,
    validate: issuerHealth(issuer),
  },
]);
