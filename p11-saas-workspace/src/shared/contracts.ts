const roles = ["admin", "editor", "viewer"] as const;
export type Role = (typeof roles)[number];

export type Organization = Readonly<{ id: string; name: string }>;
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
  monthlyCents: number;
  version: number;
}>;
export type SupportApproval = Readonly<{
  id: string;
  organizationId: string;
  projectId: string;
  operation: "project.read";
  expiresAt: string;
  version: number;
  activeUntil?: string;
}>;

export type SessionView = Readonly<{
  user: { id: string; name: string };
  csrfToken: string;
  expiresAt: string;
  activeOrganizationId: string | null;
  selectionVersion: number;
  memberships: readonly Membership[];
}>;
