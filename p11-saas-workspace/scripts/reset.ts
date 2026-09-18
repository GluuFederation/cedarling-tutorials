import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const database = new AppDatabase(loadConfig().databaseUrl);
try {
  await database.migrate();
  await database.seed();
  console.info("P11 SaaS workspace fixtures restored");
} finally {
  await database.close();
}
