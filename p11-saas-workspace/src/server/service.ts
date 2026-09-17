import { boundToken, tokenHash } from "./crypto.ts";
import { notFound } from "./errors.ts";
import { limits } from "./limits.ts";
import type { Project, SupportApproval } from "../shared/contracts.ts";
import type { Principal, WorkspaceRepository } from "./models.ts";
import type {
  AuthorizationGateway,
  AuthorizationIntent,
  Capability,
  SafeFacts,
} from "./capabilities.ts";

type AccessContext = Readonly<{
  facts: SafeFacts;
  support: readonly SupportApproval[];
}>;

export class WorkspaceService {
  private readonly repository: WorkspaceRepository;
  private readonly authorization: AuthorizationGateway;
  private readonly invitationSecret: string;

  constructor(
    repository: WorkspaceRepository,
    authorization: AuthorizationGateway,
    invitationSecret: string,
  ) {
    this.repository = repository;
    this.authorization = authorization;
    this.invitationSecret = invitationSecret;
  }

  async workspace(principal: Principal) {
    const [memberships, selection, support] = await Promise.all([
      this.repository.memberships(principal.id),
      this.repository.selection(principal.id),
      this.repository.supportApprovals(principal.id),
    ]);
    return { memberships, selection, support };
  }

  async switchOrganization(
    principal: Principal,
    requestId: string,
    organizationId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const memberships = await this.repository.memberships(principal.id);
    const membership = memberships.find(
      (item) => item.organizationId === organizationId,
    );
    await this.allow(
      requestId,
      principal.id,
      "organization.switch",
      `Organization::${organizationId}`,
      {
        currentMembership: Boolean(membership),
        currentRole: membership?.role ?? null,
        membershipCount: memberships.length,
      },
      "persist versioned active-organization selection",
    );
    return this.repository.switchOrganization(
      principal.id,
      organizationId,
      expectedVersion,
      idempotencyKey,
    );
  }

  async listProjects(
    principal: Principal,
    requestId: string,
    organizationId: string,
  ) {
    const projects = await this.repository.listProjects(organizationId);
    const access = await this.accessFacts(principal.id, organizationId);
    const visible = [];
    for (const project of projects) {
      await this.allow(
        requestId,
        principal.id,
        "project.read",
        `Project::${project.id}`,
        {
          ...this.projectFacts(access, project, "project.read"),
          projectVersion: project.version,
        },
        "return bounded project summary",
      );
      visible.push(project);
    }
    return visible;
  }

  async readProject(
    principal: Principal,
    requestId: string,
    organizationId: string,
    projectId: string,
  ) {
    const project = await this.repository.project(organizationId, projectId);
    if (!project) throw notFound("project_not_found");
    const access = await this.accessFacts(principal.id, organizationId);
    await this.allow(
      requestId,
      principal.id,
      "project.read",
      `Project::${project.id}`,
      {
        ...this.projectFacts(access, project, "project.read"),
        projectVersion: project.version,
      },
      "return one project",
    );
    return project;
  }

  async writeProject(
    principal: Principal,
    requestId: string,
    input: Readonly<{
      organizationId: string;
      projectId: string;
      name: string;
      body: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    const current = await this.repository.project(
      input.organizationId,
      input.projectId,
    );
    if (!current) throw notFound("project_not_found");
    const access = await this.accessFacts(principal.id, input.organizationId);
    await this.allow(
      requestId,
      principal.id,
      "project.write",
      `Project::${current.id}`,
      {
        ...this.projectFacts(access, current, "project.write"),
        currentVersion: current.version,
        expectedVersion: input.expectedVersion,
      },
      "conditionally update one project",
    );
    return this.repository.writeProject({
      principalId: principal.id,
      ...input,
    });
  }

  async members(
    principal: Principal,
    requestId: string,
    organizationId: string,
  ) {
    const access = await this.accessFacts(principal.id, organizationId);
    await this.allow(
      requestId,
      principal.id,
      "organization.switch",
      `Organization::${organizationId}`,
      access.facts,
      "return bounded current-organization member list",
    );
    return this.repository.members(organizationId);
  }

  async invitations(
    principal: Principal,
    requestId: string,
    organizationId: string,
  ) {
    const access = await this.accessFacts(principal.id, organizationId);
    await this.allow(
      requestId,
      principal.id,
      "invitation.issue",
      `Organization::${organizationId}`,
      access.facts,
      "return bounded current-organization invitation list",
    );
    return this.repository.invitations(organizationId);
  }

  invitationsFor(principal: Principal) {
    return this.repository.invitationsFor(principal.id);
  }

  async issueInvitation(
    principal: Principal,
    requestId: string,
    input: Readonly<{
      organizationId: string;
      targetPrincipalId: string;
      role: "editor" | "viewer";
      expectedSelectionVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    const target = await this.repository.findPrincipalById(
      input.targetPrincipalId,
    );
    if (!target) throw notFound("invitation_target_not_found");
    const access = await this.accessFacts(principal.id, input.organizationId);
    await this.allow(
      requestId,
      principal.id,
      "invitation.issue",
      `Organization::${input.organizationId}`,
      {
        ...access.facts,
        role: input.role,
        targetMapped: true,
        expectedSelectionVersion: input.expectedSelectionVersion,
      },
      "create one bounded expiring invitation",
    );
    const token = boundToken(
      this.invitationSecret,
      JSON.stringify([
        "invitation.issue",
        principal.id,
        input.organizationId,
        input.targetPrincipalId,
        input.role,
        input.expectedSelectionVersion,
        input.idempotencyKey,
      ]),
    );
    const invitation = await this.repository.issueInvitation({
      principalId: principal.id,
      ...input,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + limits.invitationMs),
    });
    return { invitation, token };
  }

  async acceptInvitation(
    principal: Principal,
    requestId: string,
    input: Readonly<{
      invitationId: string;
      token: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    await this.allow(
      requestId,
      principal.id,
      "invitation.accept",
      `Invitation::${input.invitationId}`,
      { expectedVersion: input.expectedVersion },
      "atomically consume invitation and create membership",
    );
    return this.repository.acceptInvitation({
      principalId: principal.id,
      invitationId: input.invitationId,
      tokenHash: tokenHash(input.token),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async billing(
    principal: Principal,
    requestId: string,
    organizationId: string,
  ) {
    const billing = await this.repository.billing(organizationId);
    if (!billing) throw notFound("billing_not_found");
    const access = await this.accessFacts(principal.id, organizationId);
    await this.allow(
      requestId,
      principal.id,
      "billing.view",
      `Billing::${organizationId}`,
      { ...access.facts, billingVersion: billing.version },
      "return bounded billing projection",
    );
    return billing;
  }

  supportApprovals(principal: Principal) {
    return this.repository.supportApprovals(principal.id);
  }

  async openSupport(
    principal: Principal,
    requestId: string,
    approvalId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const approval = (
      await this.repository.supportApprovals(principal.id)
    ).find((item) => item.id === approvalId);
    if (!approval) throw notFound("support_approval_not_found");
    await this.allow(
      requestId,
      principal.id,
      "support.open",
      `SupportApproval::${approval.id}`,
      {
        organizationId: approval.organizationId,
        projectId: approval.projectId,
        operation: approval.operation,
        approvalVersion: approval.version,
        expectedVersion,
        expired: new Date(approval.expiresAt).getTime() <= Date.now(),
      },
      "activate exact expiring project-read support scope",
    );
    return this.repository.openSupport({
      principalId: principal.id,
      approvalId,
      expectedVersion,
      idempotencyKey,
    });
  }

  private async accessFacts(
    principalId: string,
    organizationId: string,
  ): Promise<AccessContext> {
    const [memberships, selection, support] = await Promise.all([
      this.repository.memberships(principalId),
      this.repository.selection(principalId),
      this.repository.activeSupport(principalId),
    ]);
    const membership = memberships.find(
      (item) => item.organizationId === organizationId,
    );
    return {
      facts: {
        requestedOrganizationId: organizationId,
        activeOrganizationId: selection.organizationId,
        selectionVersion: selection.version,
        selectionMatches: selection.organizationId === organizationId,
        currentMembership: Boolean(membership),
        currentRole: membership?.role ?? null,
        organizationSupportActive: support.some(
          (item) => item.organizationId === organizationId,
        ),
      },
      support,
    };
  }

  private projectFacts(
    access: AccessContext,
    project: Project,
    operation: "project.read" | "project.write",
  ): SafeFacts {
    const exactSupport = access.support.find(
      (item) =>
        item.organizationId === project.organizationId &&
        item.projectId === project.id &&
        item.operation === operation,
    );
    return {
      ...access.facts,
      projectOrganizationId: project.organizationId,
      supportActive: Boolean(exactSupport),
      supportProjectId: exactSupport?.projectId ?? null,
      supportOperation: exactSupport?.operation ?? null,
      supportExactMatch: Boolean(exactSupport),
    };
  }

  private allow(
    requestId: string,
    principalId: string,
    capability: Capability,
    resource: string,
    facts: SafeFacts,
    effect: string,
  ): Promise<void> {
    const intent: AuthorizationIntent = {
      requestId,
      principalId,
      capability,
      resource,
      facts,
      effect,
    };
    return this.authorization.authorize(intent);
  }
}
