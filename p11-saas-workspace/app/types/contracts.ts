export type Role = "admin" | "editor" | "viewer";
export type Membership = Readonly<{
  principalId?: string;
  principalName?: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  version: number;
}>;
export type Project = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  body: string;
  authorId: string;
  version: number;
}>;
export type Invitation = Readonly<{
  id: string;
  organizationId: string;
  organizationName?: string;
  targetPrincipalId: string;
  targetName: string;
  role: Role;
  state: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  version: number;
}>;
export type Billing = Readonly<{
  organizationId: string;
  plan: string;
  seats: number;
  activeSeats: number;
  monthlyCents: number;
  version: number;
}>;
export type InvitationCandidate = Readonly<{
  id: string;
  name: string;
  state: "available" | "member" | "pending";
}>;
export type SupportApproval = Readonly<{
  id: string;
  organizationId: string;
  organizationName?: string;
  projectId: string;
  projectName?: string;
  operation: "project.read";
  expiresAt: string;
  version: number;
  activeUntil?: string;
}>;

export type SessionView = Readonly<{
  user: { name: string };
  csrfToken: string;
  activeOrganizationId: string | null;
  selectionVersion: number;
  memberships: readonly Membership[];
  navigationOrganizationId: string | null;
  switchKeys: Readonly<Record<string, string>>;
}>;
