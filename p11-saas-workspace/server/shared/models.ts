import type {
  Billing,
  Invitation,
  InvitationCandidate,
  Membership,
  Project,
  SupportApproval,
} from "../../app/types/contracts.ts";

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

/** Server-only evidence captured before a decision, checked again before a write. */
export type AuthoritySnapshot = Readonly<{
  principalId: string;
  selection: Selection;
  memberships: readonly Membership[];
  support: readonly (SupportApproval & { sessionVersion: number })[];
}>;

export type InvitationEvidence = Readonly<{
  invitation: Invitation;
  tokenMatches: boolean;
}>;

export type WriteProjectCommand = Readonly<{
  organizationId: string;
  projectId: string;
  name: string;
  body: string;
  expectedVersion: number;
  idempotencyKey: string;
}>;

export type IssueInvitationCommand = Readonly<{
  organizationId: string;
  targetPrincipalId: string;
  role: "editor" | "viewer";
  expectedSelectionVersion: number;
  idempotencyKey: string;
}>;

export type AcceptInvitationCommand = Readonly<{
  invitationId: string;
  token: string;
  expectedVersion: number;
  idempotencyKey: string;
}>;

export type ProjectWriteInput = WriteProjectCommand &
  Readonly<{
    principalId: string;
    authority: AuthoritySnapshot;
  }>;

export type InvitationIssueInput = IssueInvitationCommand &
  Readonly<{
    principalId: string;
    tokenHash: string;
    authority: AuthoritySnapshot;
  }>;

export type InvitationAcceptInput = Omit<AcceptInvitationCommand, "token"> &
  Readonly<{
    principalId: string;
    tokenHash: string;
  }>;

export type SupportOpenInput = Readonly<{
  principalId: string;
  approvalId: string;
  expectedVersion: number;
  idempotencyKey: string;
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
  findPrincipalById(id: string): Promise<Principal | undefined>;
  authority(principalId: string): Promise<AuthoritySnapshot>;
  switchOrganization(
    principalId: string,
    organizationId: string,
    expectedVersion: number,
    idempotencyKey: string,
    authority: AuthoritySnapshot,
  ): Promise<Selection>;
  listProjects(organizationId: string): Promise<readonly Project[]>;
  project(
    organizationId: string,
    projectId: string,
  ): Promise<Project | undefined>;
  writeProject(input: ProjectWriteInput): Promise<Project>;
  members(organizationId: string): Promise<readonly Membership[]>;
  invitations(organizationId: string): Promise<readonly Invitation[]>;
  invitationCandidates(
    organizationId: string,
  ): Promise<readonly InvitationCandidate[]>;
  invitationsFor(principalId: string): Promise<readonly Invitation[]>;
  invitation(
    id: string,
    tokenHash: string,
  ): Promise<InvitationEvidence | undefined>;
  issueInvitation(input: InvitationIssueInput): Promise<Invitation>;
  acceptInvitation(input: InvitationAcceptInput): Promise<Invitation>;
  billing(organizationId: string): Promise<Billing | undefined>;
  supportApprovals(principalId: string): Promise<readonly SupportApproval[]>;
  openSupport(input: SupportOpenInput): Promise<SupportApproval>;
}
