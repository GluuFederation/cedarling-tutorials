export const authorizationBoundaries = {
  "dataset.inspect": "Data::InspectDataset",
  "data.query": "Data::Query",
  "data.aggregate": "Data::Aggregate",
  "data.export": "Data::CreateExport",
  "export.revoke": "Data::RevokeExport",
  "export.download": "Data::DownloadExport",
} as const;

export type Capability = keyof typeof authorizationBoundaries;

export function logPermissiveTrace(
  input: Readonly<{
    requestId: string;
    capability: Capability;
    principalId: string;
    resourceId: string;
    facts: Record<string, string | number | boolean>;
  }>,
): void {
  console.info(
    `P5 server | FAKE ALLOW | ${input.capability} | ${input.principalId} -> ${input.resourceId}`,
  );
}
