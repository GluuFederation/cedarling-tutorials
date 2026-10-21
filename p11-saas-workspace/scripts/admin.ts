import { loadConfig } from "../server/config/environment.ts";
import { AppDatabase } from "../server/data/database.ts";

const [command, principalId, organizationId] = process.argv.slice(2);
if (
  !principalId ||
  (command === "renew-support"
    ? Boolean(organizationId)
    : (command !== "revoke" && command !== "restore") || !organizationId)
) {
  throw new Error(
    "Usage: pnpm admin <revoke|restore> <principal-id> <organization-id> | pnpm admin renew-support <approval-id>",
  );
}
const database = new AppDatabase(loadConfig().databaseUrl);
try {
  if (command === "renew-support") {
    await database.renewSupportApproval(principalId);
  } else if (command === "revoke" && organizationId) {
    await database.revokeMembership(principalId, organizationId);
  } else if (organizationId) {
    await database.restoreMembership(principalId, organizationId);
  }
  console.log(
    `${command} applied to ${principalId}${organizationId ? ` in ${organizationId}` : ""}`,
  );
} finally {
  await database.close();
}
