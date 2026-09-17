import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { sliceApplications } from "../src/slice-applications.ts";

const target = resolve(process.cwd(), ".env");
const current = existsSync(target) ? readFileSync(target, "utf8") : "";
const currentEnvironment = current ? parseEnv(current) : {};
const synchronized =
  currentEnvironment.P4_CLIENT_ID !== undefined &&
  currentEnvironment.P4_CLIENT_ID !== "p4-editorial-publishing";
const synchronizedCurrent = synchronized
  ? current.replace(
      /^(\s*(?:export\s+)?P4_CLIENT_ID\s*=).*$/mu,
      "$1p4-editorial-publishing",
    )
  : current;
const environment = synchronizedCurrent ? parseEnv(synchronizedCurrent) : {};
const generatedSecret = () => randomBytes(32).toString("base64url");

const defaults = [
  ["IDP_ISSUER", "http://idp.localhost:4000"],
  ["IDP_HOST", "127.0.0.1"],
  ["IDP_PORT", "4000"],
  ["IDP_PROFILE", "default"],
  ["P1_CLIENT_ID", "p1-task-manager"],
  ["P1_CLIENT_SECRET", generatedSecret],
  ["P1_API_RESOURCE", "http://p1.localhost:3000/api"],
  ["P1_REDIRECT_URI", "http://p1.localhost:3000/auth/callback"],
  ["P1_POST_LOGOUT_REDIRECT_URI", "http://p1.localhost:3000"],
  ["P2_CLIENT_ID", "p2-tenantrag-cli"],
  ["P2_API_RESOURCE", "http://p2.localhost:3000/api"],
  ["P3_CLIENT_ID", "p3-mcp-capability-governance-cli"],
  ["P3_MCP_RESOURCE", "http://p3.localhost:3003/mcp"],
  ["P4_CLIENT_ID", "p4-editorial-publishing"],
  ["P4_CLIENT_SECRET", generatedSecret],
  ["P4_API_RESOURCE", "http://p4.localhost:3004/api"],
  ["P4_REDIRECT_URI", "http://p4.localhost:3004/auth/callback"],
  ["P4_POST_LOGOUT_REDIRECT_URI", "http://p4.localhost:3004"],
  ["P5_CLIENT_ID", "p5-dataguard"],
  ["P5_CLIENT_SECRET", generatedSecret],
  ["P5_API_RESOURCE", "http://p5.localhost:3005/api"],
  ["P5_REDIRECT_URI", "http://p5.localhost:3005/auth/callback"],
  ["P5_POST_LOGOUT_REDIRECT_URI", "http://p5.localhost:3005"],
  ["P6_CLIENT_ID", "p6-field-inspection"],
  ["P6_CLIENT_SECRET", generatedSecret],
  ["P6_API_RESOURCE", "http://p6.localhost:3006/api"],
  ["P6_REDIRECT_URI", "http://p6.localhost:3006/auth/callback"],
  ["P6_POST_LOGOUT_REDIRECT_URI", "http://p6.localhost:3006"],
  ["P7_CLIENT_ID", "p7-collaborative-docs"],
  ["P7_CLIENT_SECRET", generatedSecret],
  ["P7_API_RESOURCE", "http://p7.localhost:3007/api"],
  ["P7_REDIRECT_URI", "http://p7.localhost:3007/auth/callback"],
  ["P7_POST_LOGOUT_REDIRECT_URI", "http://p7.localhost:3007"],
  ["P8_CLIENT_ID", "p8-cedarfile"],
  ["P8_CLIENT_SECRET", generatedSecret],
  ["P8_API_RESOURCE", "http://p8.localhost:3008/api"],
  ["P8_REDIRECT_URI", "http://p8.localhost:3008/auth/callback"],
  ["P8_POST_LOGOUT_REDIRECT_URI", "http://p8.localhost:3008"],
  ["P9_CLIENT_ID", "p9-cedarrealtime"],
  ["P9_CLIENT_SECRET", generatedSecret],
  ["P9_API_RESOURCE", "http://p9.localhost:3009/api"],
  ["P9_REDIRECT_URI", "http://p9.localhost:3009/auth/callback"],
  ["P9_POST_LOGOUT_REDIRECT_URI", "http://p9.localhost:3009"],
  ["P10_TRANSFER_PLANNER_CLIENT_ID", "p10-transfer-planner"],
  ["P10_TRANSFER_PLANNER_CLIENT_SECRET", generatedSecret],
  ["P10_WAREHOUSE_NORTH_CLIENT_ID", "p10-warehouse-north"],
  ["P10_WAREHOUSE_NORTH_CLIENT_SECRET", generatedSecret],
  ["P10_WAREHOUSE_SOUTH_CLIENT_ID", "p10-warehouse-south"],
  ["P10_WAREHOUSE_SOUTH_CLIENT_SECRET", generatedSecret],
  ["P10_INVENTORY_AUDITOR_CLIENT_ID", "p10-inventory-auditor"],
  ["P10_INVENTORY_AUDITOR_CLIENT_SECRET", generatedSecret],
  ["P10_API_RESOURCE", "http://p10.localhost:3010/api"],
  ["P11_CLIENT_ID", "p11-saas-workspace"],
  ["P11_CLIENT_SECRET", generatedSecret],
  ["P11_API_RESOURCE", "http://p11.localhost:3011/api"],
  ["P11_REDIRECT_URI", "http://p11.localhost:3011/auth/callback"],
  ["P11_POST_LOGOUT_REDIRECT_URI", "http://p11.localhost:3011"],
  ...sliceApplications.flatMap(({ prefix, id, port }) => {
    const origin = `http://${prefix.toLowerCase()}.localhost:${port}`;
    return [
      [`${prefix}_CLIENT_ID`, id],
      [`${prefix}_CLIENT_SECRET`, generatedSecret],
      [`${prefix}_API_RESOURCE`, `${origin}/api`],
      [`${prefix}_REDIRECT_URI`, `${origin}/auth/callback`],
      [`${prefix}_POST_LOGOUT_REDIRECT_URI`, origin],
    ];
  }),
];

const additions = [];
for (const [name, configuredDefault] of defaults) {
  if (Object.hasOwn(environment, name)) continue;
  const value =
    typeof configuredDefault === "function"
      ? configuredDefault()
      : configuredDefault;
  additions.push(`${name}=${value}`);
}

if (additions.length === 0 && !synchronized) {
  if (process.platform !== "win32") chmodSync(target, 0o600);
  console.log("shared/identity-provider/.env is already current");
  process.exit(0);
}

const prefix =
  synchronizedCurrent.length > 0 && !synchronizedCurrent.endsWith("\n")
    ? "\n"
    : "";
const suffix = additions.length > 0 ? `${additions.join("\n")}\n` : "";
const next = `${synchronizedCurrent}${prefix}${suffix}`;
const temporary = `${target}.${process.pid}.tmp`;
writeFileSync(temporary, next, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
renameSync(temporary, target);
if (process.platform !== "win32") chmodSync(target, 0o600);
const changes = [
  ...(synchronized ? ["synchronized the managed P4 client ID"] : []),
  ...(additions.length > 0
    ? [`added ${additions.length} missing settings`]
    : []),
];
console.log(`Identity-provider setup ${changes.join(" and ")}`);
