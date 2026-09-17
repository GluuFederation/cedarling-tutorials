import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Billing,
  Invitation,
  Membership,
  Project,
  SupportApproval,
} from "../src/shared/contracts.ts";
import { PermissiveAuthorizationGateway } from "../src/server/capabilities.ts";
import type {
  Principal,
  Selection,
  WorkspaceRepository,
} from "../src/server/models.ts";
import { unavailable } from "../src/server/errors.ts";
import { WorkspaceService } from "../src/server/service.ts";

const maya: Principal = {
  id: "user-maya",
  issuer: "http://idp.localhost:4000",
  subject: "maya",
  name: "Maya",
};
const imani: Principal = {
  ...maya,
  id: "user-imani",
  subject: "imani",
  name: "Imani",
};
const project = (id: string, organizationId: string, version = 1): Project => ({
  id,
  organizationId,
  name: id,
  body: "Synthetic project",
  authorId: "user-maya",
  version,
});
const membership = (
  organizationId: string,
  role: Membership["role"],
): Membership => ({
  organizationId,
  organizationName: organizationId,
  role,
  version: 1,
});
const support: SupportApproval = {
  id: "support-imani-a1",
  organizationId: "aster",
  projectId: "project-a1",
  operation: "project.read",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  version: 1,
  activeUntil: new Date(Date.now() + 60_000).toISOString(),
};
const invitationSecret = "test-invitation-secret-with-32-characters";
const invitation: Invitation = {
  id: "invite-lena-aster",
  organizationId: "aster",
  targetPrincipalId: "user-lena",
  targetName: "Lena",
  role: "viewer",
  state: "pending",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  version: 1,
};

function fake(
  overrides: Partial<WorkspaceRepository> = {},
): WorkspaceRepository {
  const selection: Selection = { organizationId: "aster", version: 1 };
  const billing: Billing = {
    organizationId: "aster",
    plan: "Enterprise",
    seats: 18,
    monthlyCents: 360_000,
    version: 1,
  };
  return {
    findPrincipal: async () => maya,
    findPrincipalById: async () => maya,
    memberships: async () => [membership("aster", "admin")],
    selection: async () => selection,
    switchOrganization: async (_principalId, organizationId) => ({
      organizationId,
      version: 2,
    }),
    listProjects: async (organizationId) => [
      project(`project-${organizationId}`, organizationId),
    ],
    project: async (organizationId, projectId) =>
      project(projectId, organizationId),
    writeProject: async (input) =>
      project(input.projectId, input.organizationId, input.expectedVersion + 1),
    members: async () => [membership("aster", "admin")],
    invitations: async () => [invitation],
    invitationsFor: async () => [invitation],
    issueInvitation: async () => invitation,
    acceptInvitation: async () => ({
      ...invitation,
      state: "accepted",
      version: 2,
    }),
    billing: async (organizationId) => ({ ...billing, organizationId }),
    supportApprovals: async () => [support],
    openSupport: async () => support,
    activeSupport: async () => [],
    ...overrides,
  };
}

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("P11 permissive service", () => {
  it("reproduces Maya's cross-tenant role-reuse write gap", async () => {
    const repository = fake({
      memberships: async () => [
        membership("aster", "admin"),
        membership("boreal", "viewer"),
      ],
      selection: async () => ({ organizationId: "boreal", version: 2 }),
    });
    const gateway = new PermissiveAuthorizationGateway();
    const service = new WorkspaceService(repository, gateway, invitationSecret);
    const result = await service.writeProject(maya, "request-role-reuse", {
      organizationId: "boreal",
      projectId: "project-b1",
      name: "Boreal changed by reused role",
      body: "Permissive effect",
      expectedVersion: 1,
      idempotencyKey: "role-reuse-1",
    });
    expect(result.version).toBe(2);
    expect(
      gateway.diagnostic("request-role-reuse", maya.id)?.facts.currentRole,
    ).toBe("viewer");
  });

  it("reproduces stale-route access after membership revocation", async () => {
    const gateway = new PermissiveAuthorizationGateway();
    const service = new WorkspaceService(
      fake({
        memberships: async () => [],
        selection: async () => ({ organizationId: "aster", version: 3 }),
      }),
      gateway,
      invitationSecret,
    );
    await expect(
      service.readProject(maya, "request-stale", "aster", "project-a1"),
    ).resolves.toMatchObject({ id: "project-a1" });
    expect(
      gateway.diagnostic("request-stale", maya.id)?.facts.currentMembership,
    ).toBe(false);
  });

  it("keeps exact support evidence visible while reproducing broad support", async () => {
    const gateway = new PermissiveAuthorizationGateway();
    const activeSupport = vi
      .fn<WorkspaceRepository["activeSupport"]>()
      .mockResolvedValueOnce([
        { ...support, id: "support-imani-a2", projectId: "project-a2" },
        support,
      ])
      .mockResolvedValue([support]);
    const service = new WorkspaceService(
      fake({
        memberships: async () => [],
        selection: async () => ({ organizationId: null, version: 1 }),
        activeSupport,
      }),
      gateway,
      invitationSecret,
    );
    await service.readProject(imani, "request-approved", "aster", "project-a1");
    expect(
      gateway.diagnostic("request-approved", imani.id)?.facts.supportExactMatch,
    ).toBe(true);
    await service.readProject(imani, "request-expanded", "aster", "project-a2");
    expect(
      gateway.diagnostic("request-expanded", imani.id)?.facts.supportExactMatch,
    ).toBe(false);
    await expect(
      service.billing(imani, "request-billing", "aster"),
    ).resolves.toMatchObject({ organizationId: "aster" });
  });

  it("returns the same bound invitation token for an exact retry", async () => {
    const issueInvitation = vi.fn<WorkspaceRepository["issueInvitation"]>(
      async () => invitation,
    );
    const service = new WorkspaceService(
      fake({ issueInvitation }),
      new PermissiveAuthorizationGateway(),
      invitationSecret,
    );
    const command = {
      organizationId: "aster",
      targetPrincipalId: invitation.targetPrincipalId,
      role: "viewer",
      expectedSelectionVersion: 1,
      idempotencyKey: "invite-retry-1",
    } as const;

    const first = await service.issueInvitation(
      maya,
      "request-invite-1",
      command,
    );
    const retry = await service.issueInvitation(
      maya,
      "request-invite-2",
      command,
    );

    expect(retry.token).toBe(first.token);
    expect(issueInvitation.mock.calls[0]?.[0].tokenHash).toBe(
      issueInvitation.mock.calls[1]?.[0].tokenHash,
    );
  });

  it("fails closed before a protected effect when authorization is unavailable", async () => {
    const write = vi.fn<WorkspaceRepository["writeProject"]>();
    const service = new WorkspaceService(
      fake({ writeProject: write }),
      {
        authorize: async () => {
          throw unavailable();
        },
        diagnostic: () => undefined,
      },
      invitationSecret,
    );
    await expect(
      service.writeProject(maya, "request-closed", {
        organizationId: "aster",
        projectId: "project-a1",
        name: "No effect",
        body: "No effect",
        expectedVersion: 1,
        idempotencyKey: "closed-mode-1",
      }),
    ).rejects.toMatchObject({ code: "authorization_unavailable", status: 503 });
    expect(write).not.toHaveBeenCalled();
  });
});
