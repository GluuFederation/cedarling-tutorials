import { loadConfig } from "../server/config/environment.ts";
import { AppDatabase } from "../server/data/database.ts";

const config = loadConfig();
const database = new AppDatabase(config.databaseUrl);
try {
  await database.migrate();
  await database.seed(config.issuer);
  console.info("P11 SaaS workspace fixtures restored");
} finally {
  await database.close();
}
