import { loadConfig } from "../src/config/project-config.js";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { resetCorpus } from "../src/rag/setup.js";

loadProjectEnvironment();
const config = loadConfig();
const count = await resetCorpus(config);
console.log(
  `Built ${count} verified P2 vector records at data/orama-index.json`,
);
