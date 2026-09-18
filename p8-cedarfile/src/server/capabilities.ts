export const capabilities = {
  list: { key: "resource.list", action: "File::List" },
  create: { key: "resource.create", action: "File::Create" },
  read: { key: "resource.read", action: "File::Read" },
  write: { key: "resource.write", action: "File::Write" },
  share: { key: "resource.share", action: "File::Share" },
  move: { key: "resource.move", action: "File::Move" },
  delete: { key: "resource.delete", action: "File::Delete" },
} as const;

export type Capability = (typeof capabilities)[keyof typeof capabilities];

export function logCapabilitySeam(
  input: Readonly<{
    requestId: string;
    principalId: string;
    capability: Capability;
    resourceId: string;
    facts: Readonly<Record<string, string | number | boolean | null>>;
    effect: string;
  }>,
): void {
  console.info(
    `P8 server | FAKE ALLOW | ${input.capability.key} | ${input.principalId} -> ${input.resourceId}`,
  );
}
