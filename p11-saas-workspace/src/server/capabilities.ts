import { limits } from "./limits.ts";

export const capabilityCatalog = {
  "organization.switch": "Workspace::SwitchOrganization",
  "project.read": "Workspace::ReadProject",
  "project.write": "Workspace::WriteProject",
  "invitation.issue": "Workspace::IssueInvitation",
  "invitation.accept": "Workspace::AcceptInvitation",
  "billing.view": "Workspace::ViewBilling",
  "support.open": "Workspace::OpenSupportScope",
} as const;

export type Capability = keyof typeof capabilityCatalog;
export type SafeFacts = Readonly<
  Record<string, string | number | boolean | null>
>;
export type AuthorizationIntent = Readonly<{
  requestId: string;
  principalId: string;
  capability: Capability;
  resource: string;
  facts: SafeFacts;
  effect: string;
}>;

type Diagnostic = Readonly<{
  mode: "permissive";
  requestId: string;
  principal: string;
  capability: Capability;
  action: string;
  resource: string;
  facts: SafeFacts;
  decision: "ALLOW (FAKE)";
  effect: string;
  createdAt: number;
}>;

export interface AuthorizationGateway {
  authorize(intent: AuthorizationIntent): Promise<void>;
  diagnostic(requestId: string, principalId: string): Diagnostic | undefined;
}

export class PermissiveAuthorizationGateway implements AuthorizationGateway {
  private readonly entries: Diagnostic[] = [];

  async authorize(intent: AuthorizationIntent): Promise<void> {
    const entry: Diagnostic = {
      mode: "permissive",
      requestId: intent.requestId,
      principal: intent.principalId,
      capability: intent.capability,
      action: capabilityCatalog[intent.capability],
      resource: intent.resource,
      facts: intent.facts,
      decision: "ALLOW (FAKE)",
      effect: intent.effect,
      createdAt: Date.now(),
    };
    const serialized = JSON.stringify(entry);
    if (Buffer.byteLength(serialized) > limits.diagnosticBytes) {
      throw new Error("sanitized diagnostic exceeded its bound");
    }
    this.entries.push(entry);
    const cutoff = Date.now() - limits.diagnosticTtlMs;
    while (
      this.entries.length > limits.diagnostics ||
      (this.entries[0]?.createdAt ?? Infinity) < cutoff
    ) {
      this.entries.shift();
    }
    console.info(
      `P11 server | FAKE ALLOW | ${entry.capability} | ${entry.principal} -> ${entry.resource}`,
    );
  }

  diagnostic(requestId: string, principalId: string): Diagnostic | undefined {
    return this.entries.findLast(
      (entry) =>
        entry.requestId === requestId && entry.principal === principalId,
    );
  }
}
