import type { Project, SupportApproval } from "../../app/types/contracts.ts";
import { boundToken, tokenHash } from "../auth/crypto.ts";
import { isDenied, notFound } from "../shared/errors.ts";
import type {
  AcceptInvitationCommand,
  AuthoritySnapshot,
  IssueInvitationCommand,
  Principal,
  WorkspaceRepository,
  WriteProjectCommand,
} from "../shared/models.ts";
import type {
  AuthorizationGateway,
  AuthorizationIntent,
  Capability,
  SafeFacts,
} from "./capabilities.ts";

type AccessContext = Readonly<{
  snapshot: AuthoritySnapshot;
  facts: SafeFacts;
  support: readonly SupportApproval[];
}>;

export class WorkspaceService {
  private readonly repository: WorkspaceRepository;
  private readonly authorization: AuthorizationGateway;
  private readonly invitationSecret: string;
  private readonly snapshots = new Map<string, Promise<AuthoritySnapshot>>();

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
    const { memberships, selection } = await this.snapshot(principal.id);
    return { memberships, selection };
  }

  async switchOrganization(
    principal: Principal,
    requestId: string,
    organizationId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.mutation(principal.id, async () => {
      const authority = await this.repository.authority(principal.id);
      const memberships = authority.memberships;
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
        },
        "persist versioned active-organization selection",
      );
      return this.repository.switchOrganization(
        principal.id,
        organizationId,
        expectedVersion,
        idempotencyKey,
        authority,
      );
    });
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
      try {
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
      } catch (error) {
        if (isDenied(error)) continue;
        throw error;
      }
      visible.push({
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        version: project.version,
      });
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
    try {
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
    } catch (error) {
      if (isDenied(error)) throw notFound("project_not_found");
      throw error;
    }
    return project;
  }

  async writeProject(
    principal: Principal,
    requestId: string,
    input: WriteProjectCommand,
  ) {
    return this.mutation(principal.id, async () => {
      const current = await this.repository.project(
        input.organizationId,
        input.projectId,
      );
      if (!current) throw notFound("project_not_found");
      const access = await this.accessFacts(
        principal.id,
        input.organizationId,
        await this.repository.authority(principal.id),
      );
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
        authority: access.snapshot,
        ...input,
      });
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
      "members.read",
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

  async invitationSetup(
    principal: Principal,
    requestId: string,
    organizationId: string,
  ) {
    // The invitation-management decision also covers its bounded recipient list.
    const invitations = await this.invitations(
      principal,
      requestId,
      organizationId,
    );
    const candidates =
      await this.repository.invitationCandidates(organizationId);
    return { invitations, candidates };
  }

  async issueInvitation(
    principal: Principal,
    requestId: string,
    input: IssueInvitationCommand,
  ) {
    return this.mutation(principal.id, async () => {
      const target = await this.repository.findPrincipalById(
        input.targetPrincipalId,
      );
      if (!target) throw notFound("invitation_target_not_found");
      const access = await this.accessFacts(
        principal.id,
        input.organizationId,
        await this.repository.authority(principal.id),
      );
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
        authority: access.snapshot,
      });
      return { invitation, token };
    });
  }

  async acceptInvitation(
    principal: Principal,
    requestId: string,
    input: AcceptInvitationCommand,
  ) {
    return this.mutation(principal.id, async () => {
      const evidence = await this.repository.invitation(
        input.invitationId,
        tokenHash(input.token),
      );
      if (!evidence) throw notFound("invitation_not_found");
      const { invitation, tokenMatches } = evidence;
      await this.allow(
        requestId,
        principal.id,
        "invitation.accept",
        `Invitation::${input.invitationId}`,
        {
          organizationId: invitation.organizationId,
          targetPrincipalId: invitation.targetPrincipalId,
          targetMatches: invitation.targetPrincipalId === principal.id,
          role: invitation.role,
          state: invitation.state,
          invitationVersion: invitation.version,
          expiresAt: invitation.expiresAt,
          expired: Date.parse(invitation.expiresAt) <= Date.now(),
          tokenMatches,
          expectedVersion: input.expectedVersion,
        },
        "atomically consume invitation and create membership",
      );
      return this.repository.acceptInvitation({
        principalId: principal.id,
        invitationId: input.invitationId,
        tokenHash: tokenHash(input.token),
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });
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
    return this.mutation(principal.id, async () => {
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
    });
  }

  private async accessFacts(
    principalId: string,
    organizationId: string,
    snapshot?: AuthoritySnapshot,
  ): Promise<AccessContext> {
    const current = snapshot ?? (await this.snapshot(principalId));
    const { memberships, selection, support } = current;
    const membership = memberships.find(
      (item) => item.organizationId === organizationId,
    );
    return {
      snapshot: current,
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

  private snapshot(principalId: string): Promise<AuthoritySnapshot> {
    const existing = this.snapshots.get(principalId);
    if (existing) return existing;
    const pending = this.repository.authority(principalId);
    this.snapshots.set(principalId, pending);
    void pending.catch(() => {
      if (this.snapshots.get(principalId) === pending)
        this.snapshots.delete(principalId);
    });
    return pending;
  }

  private async mutation<T>(
    principalId: string,
    effect: () => Promise<T>,
  ): Promise<T> {
    this.snapshots.delete(principalId);
    try {
      return await effect();
    } finally {
      this.snapshots.delete(principalId);
    }
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
