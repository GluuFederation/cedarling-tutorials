import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { resetDatabase } from "../src/server/database.ts";

const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
resetDatabase(config.dataDirectory, config.issuer);
console.info(
  "P4 articles, revisions, approvals, publications, and sessions restored",
);
