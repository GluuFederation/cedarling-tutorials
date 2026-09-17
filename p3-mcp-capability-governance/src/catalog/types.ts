export type SurfaceKind = "tool" | "resource" | "prompt";

export type RuntimeDescriptor = Readonly<{
  kind: SurfaceKind;
  name: string;
  schema: Readonly<Record<string, unknown>>;
}>;

export type CapabilityRecord = Readonly<{
  id: string;
  title: string;
  description: string;
  group: string;
  action: string;
  resource: string;
  owner: string;
  riskTier: "low" | "medium" | "high" | "critical";
  businessImpact: string;
  dataSensitivity: "public" | "internal" | "restricted";
  organizationalScope: string;
}>;

export type BindingRecord = Readonly<{
  capabilityId: string;
  kind: SurfaceKind;
  name: string;
  schemaDigest: string;
  cedarAction: string;
}>;

export type GovernanceCatalog = Readonly<{
  version: string;
  bindingVersion: string;
  capabilities: ReadonlyMap<string, CapabilityRecord>;
  bindings: readonly BindingRecord[];
}>;
