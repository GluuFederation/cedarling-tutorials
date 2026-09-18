import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

if (process.argv[2] !== "revoke-omar")
  throw new Error("Usage: pnpm admin revoke-omar");
const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(config.dataDirectory, config.issuer);
try {
  console.info(
    database.revokeOmar()
      ? "Omar editor authority revoked"
      : "Omar editor authority was already revoked",
  );
} finally {
  database.close();
}
