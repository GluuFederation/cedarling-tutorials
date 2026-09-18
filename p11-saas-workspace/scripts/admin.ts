import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const [command, principalId, organizationId] = process.argv.slice(2);
if (
  (command !== "revoke" && command !== "restore") ||
  !principalId ||
  !organizationId
) {
  throw new Error(
    "Usage: pnpm admin <revoke|restore> <principal-id> <organization-id>",
  );
}
const database = new AppDatabase(loadConfig().databaseUrl);
try {
  if (command === "revoke") {
    await database.revokeMembership(principalId, organizationId);
  } else {
    const result = await database.pool.query(
      `UPDATE memberships SET active = true, version = version + 1
       WHERE principal_id = $1 AND organization_id = $2 AND NOT active`,
      [principalId, organizationId],
    );
    if (!result.rowCount) throw new Error("Inactive membership not found");
  }
  console.log(`${command} applied to ${principalId} in ${organizationId}`);
} finally {
  await database.close();
}
