/** Validate a tutorial policy-store directory and build its deterministic local Cedar archive. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fflate serializes local calendar fields, so construct the fixed ZIP timestamp
// in local time to keep archive bytes identical across host time zones.
const archiveTimestamp = new Date(1980, 0, 1, 0, 0, 0);
const maximumFileBytes = 1024 * 1024;
const maximumArchiveBytes = 5 * 1024 * 1024;

function fail(message) {
  throw new Error(`Policy-store build failed: ${message}`);
}

function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must contain a JSON object`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must contain text`);
  }
  return value;
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    fail(`${label} must contain valid JSON`);
  }
}

function parsed(result, label) {
  if (result.type !== "success") {
    fail(`${label}: ${result.errors?.[0]?.message ?? "Cedar parsing failed"}`);
  }
}

function supportedPath(relative) {
  const [directory, name, extra] = relative.split("/");
  return (
    extra === undefined &&
    ((directory === "metadata.json" && name === undefined) ||
      (directory === "schema.cedarschema" && name === undefined) ||
      (directory === "policies" && name?.endsWith(".cedar")) ||
      (directory === "templates" && name?.endsWith(".cedar")) ||
      (directory === "schemas" && name?.endsWith(".cedarschema")) ||
      (directory === "entities" && name?.endsWith(".json")) ||
      (directory === "trusted-issuers" && name?.endsWith(".json")) ||
      (directory === "custom-issuers" && name?.endsWith(".json")))
  );
}

async function collectFiles(root, current = root) {
  const collected = [];
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = path.join(current, entry.name);
    const details = await lstat(absolute);
    if (details.isSymbolicLink()) fail(`${absolute} must not be a symlink`);
    if (details.isDirectory()) {
      collected.push(...(await collectFiles(root, absolute)));
      continue;
    }
    if (!details.isFile()) fail(`${absolute} must be a regular file`);
    if (details.size > maximumFileBytes) {
      fail(`${absolute} exceeds the 1 MiB source-file limit`);
    }
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (!supportedPath(relative)) {
      fail(`${relative} is not a supported policy-store file`);
    }
    collected.push({ absolute, relative });
  }
  return collected;
}

function validateMetadata(value) {
  const metadata = record(value, "metadata.json");
  text(metadata.cedar_version, "metadata.json cedar_version");
  const store = record(metadata.policy_store, "metadata.json policy_store");
  if (!/^[a-f0-9]{8,64}$/i.test(store.id ?? "")) {
    fail("metadata.json policy_store.id must be 8-64 hexadecimal characters");
  }
  text(store.name, "metadata.json policy_store.name");
  text(store.version, "metadata.json policy_store.version");
  for (const field of ["created_date", "updated_date"]) {
    const timestamp = store[field];
    if (
      typeof timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp) ||
      Number.isNaN(Date.parse(timestamp))
    ) {
      fail(
        `metadata.json policy_store.${field} must be an RFC 3339 UTC timestamp`,
      );
    }
  }
  return metadata;
}

function validateIssuer(value, label) {
  const issuer = record(value, label);
  text(issuer.name, `${label} name`);
  const endpoints = [
    issuer.openid_configuration_endpoint,
    issuer.configuration_endpoint,
  ].filter((value) => value !== undefined);
  if (endpoints.length !== 1) {
    fail(`${label} must declare exactly one discovery endpoint`);
  }
  const endpoint = text(endpoints[0], `${label} discovery endpoint`);
  let protocol;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    fail(`${label} discovery endpoint must be a valid URL`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    fail(`${label} discovery endpoint must use HTTP or HTTPS`);
  }
  const tokenMetadata = record(
    issuer.token_metadata,
    `${label} token_metadata`,
  );
  if (Object.keys(tokenMetadata).length === 0) {
    fail(`${label} must declare at least one token mapping`);
  }
  for (const [mapping, rawMetadata] of Object.entries(tokenMetadata)) {
    text(mapping, `${label} token mapping`);
    const metadata = record(rawMetadata, `${label} token_metadata.${mapping}`);
    text(
      metadata.entity_type_name,
      `${label} token_metadata.${mapping}.entity_type_name`,
    );
    if (
      metadata.required_claims !== undefined &&
      (!Array.isArray(metadata.required_claims) ||
        metadata.required_claims.some(
          (claim) => typeof claim !== "string" || claim.trim() === "",
        ))
    ) {
      fail(
        `${label} token_metadata.${mapping}.required_claims must be a text array`,
      );
    }
  }
}

async function validatePolicyStore(sourceDirectory, dependencyRoot) {
  const require = createRequire(path.join(dependencyRoot, "package.json"));
  const {
    checkParsePolicySet,
    checkParseSchema,
  } = require("@cedar-policy/cedar-wasm/nodejs");
  const files = await collectFiles(sourceDirectory);
  const byPath = new Map(files.map((file) => [file.relative, file.absolute]));
  const metadataPath = byPath.get("metadata.json");
  const schemaPath = byPath.get("schema.cedarschema");
  const splitSchemas = files.filter((file) =>
    file.relative.startsWith("schemas/"),
  );
  const policyFiles = files.filter((file) =>
    file.relative.startsWith("policies/"),
  );
  if (!metadataPath) fail("metadata.json is required");
  if (!schemaPath && splitSchemas.length === 0) {
    fail("schema.cedarschema or schemas/*.cedarschema is required");
  }
  if (schemaPath && splitSchemas.length > 0) {
    fail("use schema.cedarschema or schemas/*.cedarschema, not both");
  }
  if (policyFiles.length === 0) fail("at least one policy file is required");

  const metadata = validateMetadata(
    parseJson(await readFile(metadataPath, "utf8"), "metadata.json"),
  );
  const schemaFiles = schemaPath ? [{ absolute: schemaPath }] : splitSchemas;
  parsed(
    checkParseSchema(
      (
        await Promise.all(
          schemaFiles.map((file) => readFile(file.absolute, "utf8")),
        )
      ).join("\n\n"),
    ),
    "policy-store schema",
  );
  const policies = (
    await Promise.all(
      policyFiles.map((file) => readFile(file.absolute, "utf8")),
    )
  ).join("\n\n");
  const policyCount = [...policies.matchAll(/\b(?:permit|forbid)\s*\(/g)]
    .length;
  const policyIds = [...policies.matchAll(/@id\("([^"\\]+)"\)/g)].map(
    (match) => match[1],
  );
  if (policyCount !== policyIds.length) fail("every policy must have an @id");
  if (new Set(policyIds).size !== policyIds.length) {
    fail("policy IDs must be unique");
  }
  parsed(checkParsePolicySet({ staticPolicies: policies }), "policies");

  for (const file of files.filter((item) => item.relative.endsWith(".json"))) {
    if (file.relative === "metadata.json") continue;
    const value = parseJson(
      await readFile(file.absolute, "utf8"),
      file.relative,
    );
    if (file.relative.startsWith("trusted-issuers/")) {
      validateIssuer(value, file.relative);
    }
  }
  return { files, metadata };
}

export async function buildPolicyStore({ projectRoot, dependencyRoot }) {
  const sourceDirectory = path.join(projectRoot, "policy-store");
  const outputDirectory = path.join(projectRoot, ".local");
  const outputPath = path.join(outputDirectory, "policy-store.cjar");
  const temporaryPath = path.join(
    outputDirectory,
    `.policy-store-${process.pid}.cjar`,
  );
  const { files, metadata } = await validatePolicyStore(
    sourceDirectory,
    dependencyRoot,
  );
  const require = createRequire(path.join(dependencyRoot, "package.json"));
  const { zipSync } = require("fflate");
  const entries = {};
  for (const file of files) {
    entries[file.relative] = [
      new Uint8Array(await readFile(file.absolute)),
      { mtime: archiveTimestamp },
    ];
  }
  const archive = zipSync(entries, { level: 9 });
  if (archive.byteLength > maximumArchiveBytes) {
    fail("policy-store.cjar exceeds the 5 MiB archive limit");
  }
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, archive, { mode: 0o600 });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return {
    outputPath,
    version: metadata.policy_store.version,
    sha256,
  };
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
  const dependencyRoot = path.resolve(process.argv[3] ?? projectRoot);
  const result = await buildPolicyStore({ projectRoot, dependencyRoot });
  console.log(`Built policy store ${result.version} | sha256 ${result.sha256}`);
}
