import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureProjectIdentity } from "./setup.mjs";
import { parseEnv } from "node:util";

process.umask(0o077);
const project = process.argv[2];
if (!/^P(?:[1-9]|1[0-5])$/.test(project ?? ""))
  throw new Error("Choose an implemented Docker tutorial");
const identityDirectory = resolve(
  process.env.BOOTSTRAP_IDENTITY_DIR ?? "/identity-config",
);
const appDirectory = resolve(process.env.BOOTSTRAP_APP_DIR ?? "/app-config");
function read(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("Configuration must be a regular, unlinked file");
    return parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
function write(file, values, exists) {
  writeFileSync(
    file,
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { flag: exists ? "w" : "wx", mode: 0o600 },
  );
}
function save(file, values) {
  const current = read(file);
  if (current) {
    for (const [name, value] of Object.entries(values))
      if (Object.hasOwn(current, name) && current[name] !== value)
        throw new Error(
          `Persisted ${name} differs; use a separate Compose project for different configuration`,
        );
    if (Object.keys(values).every((name) => Object.hasOwn(current, name)))
      return;
  }
  const merged = { ...current, ...values };
  write(file, merged, Boolean(current));
}
const identityFile = resolve(identityDirectory, ".env");
const overrides = {};
if (process.env.BOOTSTRAP_ISSUER) {
  const issuer = new URL(process.env.BOOTSTRAP_ISSUER);
  overrides.IDP_ISSUER = issuer.origin;
  overrides.IDP_PORT =
    issuer.port || (issuer.protocol === "https:" ? "443" : "80");
}
if (process.env.BOOTSTRAP_BASE_URL) {
  const base = new URL(process.env.BOOTSTRAP_BASE_URL).origin;
  const resource = project === "P3" ? "MCP" : "API";
  overrides[`${project}_${resource}_RESOURCE`] =
    `${base}/${resource.toLowerCase()}`;
  if (!["P2", "P3", "P10"].includes(project)) {
    overrides[`${project}_REDIRECT_URI`] = `${base}/auth/callback`;
    overrides[`${project}_POST_LOGOUT_REDIRECT_URI`] = base;
  }
}
if (process.env.BOOTSTRAP_CLIENT_SECRET)
  overrides[`${project}_CLIENT_SECRET`] = process.env.BOOTSTRAP_CLIENT_SECRET;
save(identityFile, overrides);
const identity = ensureProjectIdentity(project, identityFile);
const appFile = resolve(appDirectory, "app.env");
const previous = read(appFile) ?? {};
const secret = (name) =>
  previous[name] ?? randomBytes(32).toString("base64url");
if (project === "P10") {
  const directory = (name) =>
    resolve(
      process.env[`BOOTSTRAP_P10_${name.toUpperCase()}_DIR`] ??
        `/p10-${name}-config`,
    );
  const consoleFile = resolve(directory("console"), "console.env");
  const priorConsole = read(consoleFile) ?? {};
  const controlSecret =
    priorConsole.P10_CONTROL_SECRET ?? randomBytes(32).toString("base64url");
  save(consoleFile, {
    P10_BASE_URL: new URL(
      process.env.BOOTSTRAP_BASE_URL ?? identity.P10_API_RESOURCE,
    ).origin,
    P10_CONTROL_SECRET: controlSecret,
    P10_TRANSFER_PLANNER_URL: "http://localhost:3111",
    P10_WAREHOUSE_NORTH_URL: "http://localhost:3112",
    P10_WAREHOUSE_SOUTH_URL: "http://localhost:3113",
    P10_INVENTORY_AUDITOR_URL: "http://localhost:3114",
  });
  save(resolve(directory("api"), "api.env"), {
    P10_ISSUER: identity.IDP_ISSUER,
    P10_API_RESOURCE: identity.P10_API_RESOURCE,
    P10_TRANSFER_PLANNER_CLIENT_ID: identity.P10_TRANSFER_PLANNER_CLIENT_ID,
    P10_WAREHOUSE_NORTH_CLIENT_ID: identity.P10_WAREHOUSE_NORTH_CLIENT_ID,
    P10_WAREHOUSE_SOUTH_CLIENT_ID: identity.P10_WAREHOUSE_SOUTH_CLIENT_ID,
    P10_INVENTORY_AUDITOR_CLIENT_ID: identity.P10_INVENTORY_AUDITOR_CLIENT_ID,
  });
  for (const [name, prefix] of [
    ["planner", "P10_TRANSFER_PLANNER"],
    ["north", "P10_WAREHOUSE_NORTH"],
    ["south", "P10_WAREHOUSE_SOUTH"],
    ["auditor", "P10_INVENTORY_AUDITOR"],
  ]) {
    save(resolve(directory(name), "agent.env"), {
      P10_ISSUER: identity.IDP_ISSUER,
      P10_API_RESOURCE: identity.P10_API_RESOURCE,
      P10_CONTROL_SECRET: controlSecret,
      P10_WAREHOUSE_API_URL: "http://localhost:3110",
      [`${prefix}_CLIENT_ID`]: identity[`${prefix}_CLIENT_ID`],
      [`${prefix}_CLIENT_SECRET`]: identity[`${prefix}_CLIENT_SECRET`],
    });
  }
  console.info(
    "P10 Docker configuration ready; existing credentials preserved.",
  );
  process.exit(0);
}
const app = Object.fromEntries(
  Object.entries(identity).filter(([name]) => name.startsWith(project + "_")),
);
app[`${project}_ISSUER`] = identity.IDP_ISSUER;
if (["P6", "P7"].includes(project)) {
  app[`${project}_BASE_URL`] = new URL(
    identity[`${project}_POST_LOGOUT_REDIRECT_URI`],
  ).origin;
}
if (["P1", "P5", "P8", "P9", "P14"].includes(project))
  app[`${project}_SESSION_ENCRYPTION_KEY`] = secret(
    `${project}_SESSION_ENCRYPTION_KEY`,
  );
if (["P4", "P11"].includes(project))
  app[`${project}_SESSION_SECRET`] = secret(`${project}_SESSION_SECRET`);
save(appFile, app);
console.info(
  `${project} Docker configuration ready; existing credentials preserved.`,
);
