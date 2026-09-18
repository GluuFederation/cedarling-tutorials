import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";
import { schemaDigest } from "./digest.js";
import type {
  BindingRecord,
  CapabilityRecord,
  GovernanceCatalog,
  RuntimeDescriptor,
  SurfaceKind,
} from "./types.js";

const capabilitySchema = z
  .object({
    id: z.string().regex(/^[a-z]+(?:[.-][a-z]+)*$/),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    group: z.string().min(1).max(80),
    action: z.string().min(1).max(120),
    resource: z.string().min(1).max(120),
    owner: z.string().min(1).max(120),
    risk_tier: z.enum(["low", "medium", "high", "critical"]),
    business_impact: z.string().min(1).max(300),
    data_sensitivity: z.enum(["public", "internal", "restricted"]),
    organizational_scope: z.string().min(1).max(120),
  })
  .strict();

const accSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    system: z.literal("govops-incident-assistant"),
    capabilities: z.array(capabilitySchema).length(6),
  })
  .strict();

const bindingSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    acc_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    protocol: z.literal(MCP_PROTOCOL_VERSION),
    bindings: z.array(
      z
        .object({
          capability_id: z.string().min(1),
          kind: z.enum(["tool", "resource", "prompt"]),
          name: z.string().min(1),
          schema_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          cedar_action: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label}`);
  }
}

/** Validates both governance files and their cross-file identities at startup. */
export async function loadGovernanceCatalog(
  accPath: string,
  bindingPath: string,
): Promise<GovernanceCatalog> {
  const [accText, bindingText] = await Promise.all([
    readFile(accPath, "utf8"),
    readFile(bindingPath, "utf8"),
  ]);
  const acc = accSchema.parse(parse(accText));
  const binding = bindingSchema.parse(JSON.parse(bindingText));
  if (binding.acc_version !== acc.version) {
    throw new Error("MCP binding targets a different ACC version");
  }

  unique(
    acc.capabilities.map(({ id }) => id),
    "ACC capability ID",
  );
  unique(
    binding.bindings.map(({ capability_id }) => capability_id),
    "binding capability ID",
  );
  unique(
    binding.bindings.map(({ kind, name }) => `${kind}:${name}`),
    "binding surface",
  );

  const capabilities = new Map<string, CapabilityRecord>(
    acc.capabilities.map((record) => [
      record.id,
      {
        id: record.id,
        title: record.title,
        description: record.description,
        group: record.group,
        action: record.action,
        resource: record.resource,
        owner: record.owner,
        riskTier: record.risk_tier,
        businessImpact: record.business_impact,
        dataSensitivity: record.data_sensitivity,
        organizationalScope: record.organizational_scope,
      },
    ]),
  );
  const bindings: BindingRecord[] = binding.bindings.map((record) => {
    const capability = capabilities.get(record.capability_id);
    if (!capability) {
      throw new Error(
        `Binding references unknown capability: ${record.capability_id}`,
      );
    }
    if (capability.action !== record.cedar_action) {
      throw new Error(
        `Binding action differs from ACC: ${record.capability_id}`,
      );
    }
    return {
      capabilityId: record.capability_id,
      kind: record.kind,
      name: record.name,
      schemaDigest: record.schema_digest,
      cedarAction: record.cedar_action,
    };
  });

  return {
    version: acc.version,
    bindingVersion: binding.version,
    capabilities,
    bindings,
  };
}

function key(kind: SurfaceKind, name: string): string {
  return `${kind}:${name}`;
}

export type ReconciliationReport = Readonly<{
  status: "aligned" | "drift";
  runtimeOnly: readonly string[];
  catalogOnly: readonly string[];
  schemaMismatch: readonly string[];
  unboundCatalogCapabilities: readonly string[];
}>;

/** Treats bounded runtime discovery as observation and reviewed files as authority. */
export function reconcileCatalog(
  catalog: GovernanceCatalog,
  observed: readonly RuntimeDescriptor[],
): ReconciliationReport {
  const runtime = new Map(
    observed.map((descriptor) => [
      key(descriptor.kind, descriptor.name),
      schemaDigest(descriptor.schema),
    ]),
  );
  const binding = new Map(
    catalog.bindings.map((record) => [
      key(record.kind, record.name),
      record.schemaDigest,
    ]),
  );
  const runtimeOnly = [...runtime.keys()]
    .filter((surface) => !binding.has(surface))
    .sort();
  const catalogOnly = [...binding.keys()]
    .filter((surface) => !runtime.has(surface))
    .sort();
  const schemaMismatch = [...binding.entries()]
    .filter(
      ([surface, expected]) =>
        runtime.has(surface) && runtime.get(surface) !== expected,
    )
    .map(([surface]) => surface)
    .sort();
  const boundCapabilities = new Set(
    catalog.bindings.map(({ capabilityId }) => capabilityId),
  );
  const unboundCatalogCapabilities = [...catalog.capabilities.keys()]
    .filter((capabilityId) => !boundCapabilities.has(capabilityId))
    .sort();
  const status =
    runtimeOnly.length +
      catalogOnly.length +
      schemaMismatch.length +
      unboundCatalogCapabilities.length ===
    0
      ? "aligned"
      : "drift";
  return {
    status,
    runtimeOnly,
    catalogOnly,
    schemaMismatch,
    unboundCatalogCapabilities,
  };
}

export function bindingFor(
  catalog: GovernanceCatalog,
  kind: SurfaceKind,
  name: string,
): BindingRecord | undefined {
  return catalog.bindings.find(
    (record) => record.kind === kind && record.name === name,
  );
}
