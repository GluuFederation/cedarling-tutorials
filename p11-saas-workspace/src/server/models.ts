import type {
  Billing,
  Invitation,
  Membership,
  Project,
  SupportApproval,
} from "../shared/contracts.ts";

export type Principal = Readonly<{
  id: string;
  issuer: string;
  subject: string;
  name: string;
}>;

export type Selection = Readonly<{
  organizationId: string | null;
  version: number;
}>;

export type OidcTransaction = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
}>;

export type OidcTokens = Readonly<{
  issuer: string;
  subject: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  idToken: string;
  idTokenExpiresAt: number;
  tokenType: string;
  scope: string;
}>;

export type Session = Readonly<{
  principal: Principal;
  csrfToken: string;
  encryptedTokens: string;
  expiresAt: number;
}>;

export interface WorkspaceRepository {
  findPrincipal(
    issuer: string,
    subject: string,
  ): Promise<Principal | undefined>;
  findPrincipalById(id: string): Promise<Principal | undefined>;
  memberships(principalId: string): Promise<readonly Membership[]>;
  selection(principalId: string): Promise<Selection>;
  switchOrganization(
    principalId: string,
    organizationId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<Selection>;
  listProjects(organizationId: string): Promise<readonly Project[]>;
  project(
    organizationId: string,
    projectId: string,
  ): Promise<Project | undefined>;
  writeProject(
    input: Readonly<{
      principalId: string;
      organizationId: string;
      projectId: string;
      name: string;
      body: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<Project>;
  members(organizationId: string): Promise<readonly Membership[]>;
  invitations(organizationId: string): Promise<readonly Invitation[]>;
  invitationsFor(principalId: string): Promise<readonly Invitation[]>;
  issueInvitation(
    input: Readonly<{
      principalId: string;
      organizationId: string;
      targetPrincipalId: string;
      role: "editor" | "viewer";
      expectedSelectionVersion: number;
      idempotencyKey: string;
      tokenHash: string;
      expiresAt: Date;
    }>,
  ): Promise<Invitation>;
  acceptInvitation(
    input: Readonly<{
      principalId: string;
      invitationId: string;
      tokenHash: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<Invitation>;
  billing(organizationId: string): Promise<Billing | undefined>;
  supportApprovals(principalId: string): Promise<readonly SupportApproval[]>;
  openSupport(
    input: Readonly<{
      principalId: string;
      approvalId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<SupportApproval>;
  activeSupport(principalId: string): Promise<readonly SupportApproval[]>;
}
