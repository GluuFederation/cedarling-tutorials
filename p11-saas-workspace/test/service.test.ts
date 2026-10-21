import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Billing,
  Invitation,
  Membership,
  Project,
  SupportApproval,
} from "../app/types/contracts.ts";
import { AppError, conflict } from "../server/shared/errors.ts";
import type {
  Principal,
  Selection,
  WorkspaceRepository,
} from "../server/shared/models.ts";
import {
  type AuthorizationGateway,
  PermissiveAuthorizationGateway,
} from "../server/workspace/capabilities.ts";
import { WorkspaceService } from "../server/workspace/service.ts";

const denied = () => new AppError("authorization_denied", 403);
const unavailable = () => new AppError("authorization_unavailable", 503);

const maya: Principal = {
  id: "user-maya",
  issuer: "http://localhost:18011",
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
  overrides: Partial<WorkspaceRepository> & {
    memberships?: (principalId: string) => Promise<readonly Membership[]>;
    selection?: (principalId: string) => Promise<Selection>;
  } = {},
): WorkspaceRepository {
  const selection: Selection = { organizationId: "aster", version: 1 };
  const {
    memberships = async () => [membership("aster", "admin")],
    selection: currentSelection = async () => selection,
    ...methods
  } = overrides;
  const billing: Billing = {
    organizationId: "aster",
    plan: "Enterprise",
    seats: 18,
    activeSeats: 2,
    monthlyCents: 360_000,
    version: 1,
  };
  const repository: WorkspaceRepository = {
    findPrincipalById: async () => maya,
    authority: async (principalId) => ({
      principalId,
      selection: await currentSelection(principalId),
      memberships: await memberships(principalId),
      support: [],
    }),
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
    invitationCandidates: async () => [],
    invitationsFor: async () => [invitation],
    invitation: async () => ({ invitation, tokenMatches: true }),
    issueInvitation: async () => invitation,
    acceptInvitation: async () => ({
      ...invitation,
      state: "accepted",
      version: 2,
    }),
    billing: async (organizationId) => ({ ...billing, organizationId }),
    supportApprovals: async () => [support],
    openSupport: async () => support,
    ...methods,
  };
  return repository;
}

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("P11 permissive service", () => {
  it("authorizes invitation setup before disclosing candidates", async () => {
    const candidates = [
      { id: imani.id, name: imani.name, state: "available" as const },
    ];
    const invitationCandidates = vi.fn(async () => candidates);
    const authorize = vi.fn<AuthorizationGateway["authorize"]>(
      async () => undefined,
    );
    const repository = fake({ invitationCandidates });
    const service = new WorkspaceService(
      repository,
      { authorize },
      invitationSecret,
    );
    await expect(
      service.invitationSetup(maya, "invite-setup", "aster"),
    ).resolves.toEqual({ invitations: [invitation], candidates });
    expect(authorize).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "invitation.issue",
        resource: "Organization::aster",
      }),
    );
    invitationCandidates.mockClear();
    const deniedService = new WorkspaceService(
      repository,
      {
        authorize: async () => {
          throw denied();
        },
      },
      invitationSecret,
    );
    await expect(
      deniedService.invitationSetup(maya, "denied-setup", "aster"),
    ).rejects.toMatchObject({ code: "authorization_denied" });
    expect(invitationCandidates).not.toHaveBeenCalled();
  });

  it("authorizes member disclosure separately using the requested workspace's current facts", async () => {
    const members = vi.fn<WorkspaceRepository["members"]>(async () => []);
    const authorize = vi.fn<AuthorizationGateway["authorize"]>(
      async () => undefined,
    );
    const service = new WorkspaceService(
      fake({
        members,
        memberships: async () => [
          membership("aster", "admin"),
          membership("boreal", "viewer"),
        ],
        selection: async () => ({ organizationId: "boreal", version: 2 }),
      }),
      { authorize },
      invitationSecret,
    );
    await service.members(maya, "members-request", "boreal");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "members.read",
        resource: "Organization::boreal",
        facts: expect.objectContaining({
          requestedOrganizationId: "boreal",
          activeOrganizationId: "boreal",
          selectionMatches: true,
          currentMembership: true,
          currentRole: "viewer",
        }),
      }),
    );
    expect(members).toHaveBeenCalledWith("boreal");
  });

  it("does not fetch the member directory after a denied read", async () => {
    const members = vi.fn<WorkspaceRepository["members"]>(async () => []);
    const service = new WorkspaceService(
      fake({ members }),
      {
        authorize: async () => {
          throw denied();
        },
      },
      invitationSecret,
    );
    await expect(
      service.members(imani, "denied-members", "aster"),
    ).rejects.toMatchObject({ code: "authorization_denied" });
    expect(members).not.toHaveBeenCalled();
  });

  it("returns billing and seat usage under billing.view alone", async () => {
    const members = vi.fn<WorkspaceRepository["members"]>(async () => {
      throw denied();
    });
    const authorize = vi.fn<AuthorizationGateway["authorize"]>(
      async (intent) => {
        if (intent.capability !== "billing.view") throw denied();
      },
    );
    const service = new WorkspaceService(
      fake({ members }),
      { authorize },
      invitationSecret,
    );
    await expect(
      service.billing(maya, "billing-request", "aster"),
    ).resolves.toMatchObject({ activeSeats: 2, seats: 18 });
    expect(authorize).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "billing.view" }),
    );
    expect(members).not.toHaveBeenCalled();
  });

  it("reuses request-local facts without reusing resource decisions or crossing principals and requests", async () => {
    const repository = fake();
    const authority = vi.spyOn(repository, "authority");
    const authorize = vi.fn<AuthorizationGateway["authorize"]>(
      async () => undefined,
    );
    const service = new WorkspaceService(
      repository,
      { authorize },
      invitationSecret,
    );
    await Promise.all([
      service.workspace(maya),
      service.readProject(maya, "read-request", "aster", "project-a1"),
      service.listProjects(maya, "read-request", "aster"),
    ]);
    expect(authority).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    await service.workspace(imani);
    expect(authority).toHaveBeenCalledTimes(2);
    await new WorkspaceService(
      repository,
      { authorize },
      invitationSecret,
    ).workspace(maya);
    expect(authority).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])(
    "refreshes facts before a mutation and after its completion (failure: %s)",
    async (failure) => {
      let role: Membership["role"] = "admin";
      let service: WorkspaceService;
      const repository = fake({
        memberships: async () => [membership("aster", role)],
        writeProject: async () => {
          // A read during the effect must not leave a stale snapshot for revalidation.
          await service.workspace(maya);
          role = "editor";
          if (failure) throw conflict();
          return project("project-a1", "aster", 2);
        },
      });
      const authorize = vi.fn<AuthorizationGateway["authorize"]>(
        async () => undefined,
      );
      service = new WorkspaceService(
        repository,
        { authorize },
        invitationSecret,
      );
      await service.workspace(maya);
      role = "viewer";
      const saved = service.writeProject(maya, "write-request", {
        organizationId: "aster",
        projectId: "project-a1",
        name: "New name",
        body: "New body",
        expectedVersion: 1,
        idempotencyKey: "write-key",
      });
      if (failure) await expect(saved).rejects.toMatchObject({ status: 409 });
      else await expect(saved).resolves.toMatchObject({ version: 2 });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          facts: expect.objectContaining({ currentRole: "viewer" }),
        }),
      );
      expect((await service.workspace(maya)).memberships[0]?.role).toBe(
        "editor",
      );
    },
  );

  it("can retry a failed fact load within the request", async () => {
    const repository = fake();
    const authority = vi
      .spyOn(repository, "authority")
      .mockRejectedValueOnce(unavailable());
    const service = new WorkspaceService(
      repository,
      new PermissiveAuthorizationGateway(),
      invitationSecret,
    );
    await expect(service.workspace(maya)).rejects.toMatchObject({
      status: 503,
    });
    await expect(service.workspace(maya)).resolves.toHaveProperty(
      "memberships",
    );
    expect(authority).toHaveBeenCalledTimes(2);
  });

  it("filters only explicit denials and returns summaries without project bodies", async () => {
    const authorize = vi.fn(async (intent: { resource: string }) => {
      if (intent.resource === "Project::project-a2") throw denied();
    });
    const service = new WorkspaceService(
      fake({
        listProjects: async () => [
          project("project-a1", "aster"),
          project("project-a2", "aster"),
        ],
      }),
      { authorize },
      invitationSecret,
    );
    expect(await service.listProjects(maya, "request-list", "aster")).toEqual([
      {
        id: "project-a1",
        organizationId: "aster",
        name: "project-a1",
        version: 1,
      },
    ]);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("does not turn an authorization outage into an empty project list", async () => {
    const service = new WorkspaceService(
      fake(),
      {
        authorize: async () => {
          throw unavailable();
        },
      },
      invitationSecret,
    );
    await expect(
      service.listProjects(maya, "request-outage", "aster"),
    ).rejects.toMatchObject({ code: "authorization_unavailable", status: 503 });
  });

  it("uses the same not-found result for denied and absent project reads", async () => {
    const gateway = {
      authorize: async () => {
        throw denied();
      },
    };
    for (const repository of [
      fake(),
      fake({ project: async () => undefined }),
    ]) {
      const service = new WorkspaceService(
        repository,
        gateway,
        invitationSecret,
      );
      await expect(
        service.readProject(maya, "request-hidden", "aster", "project-a1"),
      ).rejects.toMatchObject({ code: "project_not_found", status: 404 });
    }
  });

  it("passes current invitation bindings to authorization without exposing the token", async () => {
    const gateway = {
      authorize: vi.fn<AuthorizationGateway["authorize"]>(
        async () => undefined,
      ),
    };
    const accept = vi.fn<WorkspaceRepository["acceptInvitation"]>(
      async () => invitation,
    );
    const service = new WorkspaceService(
      fake({ acceptInvitation: accept }),
      gateway,
      invitationSecret,
    );
    await service.acceptInvitation(maya, "request-accept", {
      invitationId: invitation.id,
      token: "private-test-token",
      expectedVersion: 1,
      idempotencyKey: "accept-key",
    });
    const intent = gateway.authorize.mock.calls[0]?.[0];
    expect(intent?.facts).toMatchObject({
      organizationId: "aster",
      targetPrincipalId: "user-lena",
      targetMatches: false,
      role: "viewer",
      state: "pending",
      invitationVersion: 1,
      tokenMatches: true,
    });
    expect(JSON.stringify(intent)).not.toContain("private-test-token");
    expect(accept).toHaveBeenCalledOnce();
  });

  it("reproduces Maya's cross-tenant role-reuse write gap", async () => {
    const repository = fake({
      memberships: async () => [
        membership("aster", "admin"),
        membership("boreal", "viewer"),
      ],
      selection: async () => ({ organizationId: "boreal", version: 2 }),
    });
    const gateway = {
      authorize: vi.fn<AuthorizationGateway["authorize"]>(
        async () => undefined,
      ),
    };
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
    expect(gateway.authorize.mock.calls[0]?.[0]?.facts.currentRole).toBe(
      "viewer",
    );
  });

  it("reproduces stale-route access after membership revocation", async () => {
    const gateway = {
      authorize: vi.fn<AuthorizationGateway["authorize"]>(
        async () => undefined,
      ),
    };
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
    expect(gateway.authorize.mock.calls[0]?.[0]?.facts.currentMembership).toBe(
      false,
    );
  });

  it("keeps exact support evidence visible while reproducing broad support", async () => {
    const gateway = {
      authorize: vi.fn<AuthorizationGateway["authorize"]>(
        async () => undefined,
      ),
    };
    const snapshot = {
      principalId: imani.id,
      selection: { organizationId: null, version: 1 },
      memberships: [],
      support: [{ ...support, sessionVersion: 1 }],
    };
    const authority = vi
      .fn<WorkspaceRepository["authority"]>()
      .mockResolvedValue(snapshot);
    const service = new WorkspaceService(
      fake({
        memberships: async () => [],
        selection: async () => ({ organizationId: null, version: 1 }),
        authority,
      }),
      gateway,
      invitationSecret,
    );
    await service.readProject(imani, "request-approved", "aster", "project-a1");
    expect(gateway.authorize.mock.calls[0]?.[0]?.facts.supportExactMatch).toBe(
      true,
    );
    await service.readProject(imani, "request-expanded", "aster", "project-a2");
    expect(gateway.authorize.mock.calls[1]?.[0]?.facts.supportExactMatch).toBe(
      false,
    );
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
