/** Prepares the host chat configuration without changing another project's IdP. */
import { resolve } from "node:path";

import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";

const target = resolve(".env");
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {},
  defaults: {
    P3_PROVIDER_TIMEOUT_MS: "15000",
  },
});
writePrivateEnvironment(target, merged.text);
console.log(
  `Synchronized ${merged.synchronizedKeys.join(", ") || "no"} environment keys.`,
);
