export const capabilityCatalog = {
  "organization.switch": "Workspace::SwitchOrganization",
  "members.read": "Workspace::ReadMembers",
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

export interface AuthorizationGateway {
  authorize(intent: AuthorizationIntent): Promise<void>;
}

export class PermissiveAuthorizationGateway implements AuthorizationGateway {
  async authorize(intent: AuthorizationIntent): Promise<void> {
    console.info(
      `P11 server | FAKE ALLOW | ${intent.capability} | ${intent.principalId} -> ${intent.resource} | ${intent.requestId}`,
    );
  }
}
