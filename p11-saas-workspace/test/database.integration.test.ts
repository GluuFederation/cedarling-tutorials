import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { tokenHash } from "../server/auth/crypto.ts";
import { AppDatabase } from "../server/data/database.ts";
import { PermissiveAuthorizationGateway } from "../server/workspace/capabilities.ts";
import { WorkspaceService } from "../server/workspace/service.ts";

const connectionString = process.env.P11_TEST_DATABASE_URL;

describe.skipIf(!connectionString)(
  "PostgreSQL invitation and support lifecycle",
  () => {
    const schema = `p11_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString });
    let database: AppDatabase;

    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(connectionString ?? "postgresql://unused");
      url.searchParams.set("options", `-csearch_path=${schema}`);
      database = new AppDatabase(url.toString());
      await database.migrate();
      await database.seed("http://localhost:18011");
    });

    afterAll(async () => {
      await database?.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await database.seed("http://localhost:18011");
    });

    async function issue(targetPrincipalId = "user-imani") {
      return {
        principalId: "user-maya",
        organizationId: "aster",
        targetPrincipalId,
        role: "viewer" as const,
        expectedSelectionVersion: 1,
        idempotencyKey: randomUUID(),
        tokenHash: tokenHash(randomUUID()),
        authority: await database.authority("user-maya"),
      };
    }

    it("seeds identities for the configured issuer and restores the default on explicit reset", async () => {
      const alternateIssuer = "http://localhost:19011";
      await database.seed(alternateIssuer);
      expect(
        await database.findPrincipal(alternateIssuer, "maya"),
      ).toMatchObject({ id: "user-maya" });
      expect(
        await database.findPrincipal("http://localhost:18011", "maya"),
      ).toBeUndefined();
      await database.seed("http://localhost:18011");
      expect(
        await database.findPrincipal("http://localhost:18011", "maya"),
      ).toMatchObject({ id: "user-maya" });
      expect(
        await database.findPrincipal(alternateIssuer, "maya"),
      ).toBeUndefined();
    });

    it("initializes an empty database with its configured issuer and preserves populated data", async () => {
      await database.pool.query("TRUNCATE principals CASCADE");
      await database.initialize("http://localhost:19011");
      expect(
        await database.findPrincipal("http://localhost:19011", "maya"),
      ).toMatchObject({ id: "user-maya" });
      await database.pool.query(
        "UPDATE projects SET name = 'Preserved edit' WHERE id = 'project-a1'",
      );
      await database.initialize("http://localhost:18011");
      expect(
        await database.findPrincipal("http://localhost:19011", "maya"),
      ).toMatchObject({ id: "user-maya" });
      expect(await database.project("aster", "project-a1")).toMatchObject({
        name: "Preserved edit",
      });
    });

    it("rolls back the whole reseed when issuer assignment fails", async () => {
      await database.pool.query(
        "UPDATE projects SET name = 'Preserved edit' WHERE id = 'project-a1'",
      );
      await database.pool.query(
        "ALTER TABLE principals ADD CONSTRAINT test_seed_issuer CHECK (issuer = 'http://localhost:18011')",
      );
      try {
        await expect(
          database.seed("http://localhost:19011"),
        ).rejects.toMatchObject({ code: "23514" });
        expect(await database.project("aster", "project-a1")).toMatchObject({
          name: "Preserved edit",
        });
        expect(
          await database.findPrincipal("http://localhost:18011", "maya"),
        ).toMatchObject({ id: "user-maya" });
      } finally {
        await database.pool.query(
          "ALTER TABLE principals DROP CONSTRAINT test_seed_issuer",
        );
      }
    });

    it("counts active billing seats without fetching the member directory", async () => {
      expect(await database.billing("aster")).toMatchObject({
        activeSeats: 2,
        seats: 18,
      });
      await database.revokeMembership("user-noah", "aster");
      expect(await database.billing("aster")).toMatchObject({
        activeSeats: 1,
        seats: 18,
      });
    });

    it("projects candidate states from current memberships and unexpired invitations", async () => {
      expect(await database.invitationCandidates("aster")).toEqual([
        { id: "user-imani", name: "Imani", state: "available" },
        { id: "user-lena", name: "Lena", state: "pending" },
        { id: "user-maya", name: "Maya", state: "member" },
        { id: "user-noah", name: "Noah", state: "member" },
      ]);
      await database.pool.query(
        "UPDATE invitations SET expires_at = now() - interval '1 second'",
      );
      expect(await database.invitationCandidates("aster")).toContainEqual({
        id: "user-lena",
        name: "Lena",
        state: "available",
      });
      await database.revokeMembership("user-noah", "aster");
      expect(await database.invitationCandidates("aster")).toContainEqual({
        id: "user-noah",
        name: "Noah",
        state: "available",
      });
      expect(await database.invitationCandidates("boreal")).toContainEqual({
        id: "user-lena",
        name: "Lena",
        state: "available",
      });
      expect(await database.supportApprovals("user-imani")).toContainEqual(
        expect.objectContaining({
          organizationName: "Tenant A · Aster",
          projectName: "Aster checkout hardening",
        }),
      );
    });

    it("lets Lena use a fresh invitation after the seed invitation expires", async () => {
      await database.pool.query(
        "UPDATE invitations SET expires_at = clock_timestamp() - interval '1 second' WHERE id = 'invite-lena-aster'",
      );
      const maya = await database.findPrincipalById("user-maya");
      const lena = await database.findPrincipalById("user-lena");
      if (!maya || !lena) throw new Error("Missing invitation fixtures");
      const service = new WorkspaceService(
        database,
        new PermissiveAuthorizationGateway(),
        "test-invitation-secret-with-32-characters",
      );
      const replacement = await service.issueInvitation(
        maya,
        "replace-invitation",
        {
          organizationId: "aster",
          targetPrincipalId: lena.id,
          role: "viewer",
          expectedSelectionVersion: 1,
          idempotencyKey: randomUUID(),
        },
      );
      expect(
        (await database.invitationsFor(lena.id)).find(
          (item) => item.id === "invite-lena-aster",
        ),
      ).toHaveProperty("state", "expired");
      expect(replacement.token).not.toBe("p11-lena-invite-token");
      await expect(
        service.acceptInvitation(lena, "accept-fresh-invitation", {
          invitationId: replacement.invitation.id,
          token: replacement.token,
          expectedVersion: replacement.invitation.version,
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ state: "accepted" });
      expect((await database.authority(lena.id)).memberships).toHaveLength(1);
      expect((await database.authority(lena.id)).selection).toEqual({
        organizationId: null,
        version: 1,
      });
    });

    for (const change of ["membership", "support"] as const) {
      it(`preserves an Aster write when an unrelated Boreal ${change} changes during authorization`, async () => {
        if (change === "support") {
          await database.pool.query(`INSERT INTO support_approvals
            (id, principal_id, organization_id, project_id, operation, expires_at)
            VALUES ('support-maya-b1', 'user-maya', 'boreal', 'project-b1', 'project.read', clock_timestamp() + interval '1 hour')`);
          await database.openSupport({
            principalId: "user-maya",
            approvalId: "support-maya-b1",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          });
        }
        const maya = await database.findPrincipalById("user-maya");
        if (!maya) throw new Error("Missing Maya fixture");
        const service = new WorkspaceService(
          database,
          {
            authorize: async () => {
              if (change === "membership")
                await database.revokeMembership(maya.id, "boreal");
              else await database.renewSupportApproval("support-maya-b1");
            },
          },
          "test-invitation-secret-with-32-characters",
        );
        await expect(
          service.writeProject(maya, "unrelated-change", {
            organizationId: "aster",
            projectId: "project-a1",
            name: "Aster edit",
            body: "Still valid",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        ).resolves.toMatchObject({ version: 2, name: "Aster edit" });
      });
    }

    for (const operation of ["switch", "invite"] as const) {
      it(`fences current membership changes before ${operation}`, async () => {
        const maya = await database.findPrincipalById("user-maya");
        if (!maya) throw new Error("Missing Maya fixture");
        const service = new WorkspaceService(
          database,
          {
            authorize: async () => {
              await database.revokeMembership(maya.id, "aster");
            },
          },
          "test-invitation-secret-with-32-characters",
        );
        const effect =
          operation === "switch"
            ? service.switchOrganization(
                maya,
                "relevant-change",
                "aster",
                1,
                randomUUID(),
              )
            : service.issueInvitation(maya, "relevant-change", {
                organizationId: "aster",
                targetPrincipalId: "user-imani",
                role: "viewer",
                expectedSelectionVersion: 1,
                idempotencyKey: randomUUID(),
              });
        await expect(effect).rejects.toMatchObject({
          code: "authority_changed",
          status: 409,
        });
        expect((await database.authority(maya.id)).selection).toEqual({
          organizationId: "aster",
          version: 1,
        });
        expect(
          (await database.invitations("aster")).some(
            (item) => item.targetPrincipalId === "user-imani",
          ),
        ).toBe(false);
      });
    }

    it("returns useful conflicts for an existing member and a pending invitation", async () => {
      await expect(
        database.issueInvitation(await issue("user-noah")),
      ).rejects.toMatchObject({
        code: "membership_already_exists",
        status: 409,
      });
      await expect(
        database.issueInvitation(await issue("user-lena")),
      ).rejects.toMatchObject({
        code: "invitation_already_pending",
        status: 409,
      });
    });

    it("serializes concurrent invitations, and replays only the exact request", async () => {
      const input = await issue();
      const results = await Promise.allSettled([
        database.issueInvitation(input),
        database.issueInvitation({ ...input, idempotencyKey: randomUUID() }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ reason: { code: "invitation_already_pending" } });
      const winner = results.find((result) => result.status === "fulfilled");
      if (results[0]?.status === "fulfilled") {
        expect(await database.issueInvitation(input)).toEqual(winner?.value);
      }
      const invitations = await database.invitations("aster");
      expect(
        invitations.filter((item) => item.targetPrincipalId === "user-imani"),
      ).toHaveLength(1);
    });

    it("keeps pending invitations ahead of a bounded terminal history", async () => {
      await database.pool.query(`INSERT INTO invitations
        (id, organization_id, target_principal_id, role, issuer_id, token_hash, expires_at, state)
        SELECT 'history-' || n, 'aster', 'user-lena', 'viewer', 'user-maya', 'unused-' || n,
          clock_timestamp() - interval '1 day', 'expired' FROM generate_series(1,25) n`);
      for (const invitations of [
        await database.invitations("aster"),
        await database.invitationsFor("user-lena"),
      ]) {
        expect(invitations).toHaveLength(20);
        expect(invitations[0]?.id).toBe("invite-lena-aster");
      }
    });

    it("preserves invitation target, token, and single-use checks", async () => {
      const input = {
        principalId: "user-lena",
        invitationId: "invite-lena-aster",
        tokenHash: tokenHash("p11-lena-invite-token"),
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      };
      await expect(
        database.acceptInvitation({ ...input, principalId: "user-imani" }),
      ).rejects.toMatchObject({ code: "invitation_target_mismatch" });
      await expect(
        database.acceptInvitation({ ...input, tokenHash: "wrong" }),
      ).rejects.toMatchObject({ code: "invitation_token_mismatch" });
      const results = await Promise.allSettled([
        database.acceptInvitation(input),
        database.acceptInvitation({ ...input, idempotencyKey: randomUUID() }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ reason: { code: "invitation_not_pending" } });
      expect((await database.authority("user-lena")).memberships).toHaveLength(
        1,
      );
    });

    for (const change of ["membership", "selection", "support"] as const) {
      it(`rejects a write without an effect when ${change} changes during authorization`, async () => {
        const principalId = change === "support" ? "user-imani" : "user-maya";
        if (change === "support")
          await database.openSupport({
            principalId,
            approvalId: "support-imani-a1",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          });
        const principal = await database.findPrincipalById(principalId);
        if (!principal) throw new Error("Missing principal fixture");
        const original = await database.project("aster", "project-a1");
        const service = new WorkspaceService(
          database,
          {
            authorize: async () => {
              if (change === "membership")
                await database.revokeMembership(principalId, "aster");
              else if (change === "selection")
                await database.switchOrganization(
                  principalId,
                  "boreal",
                  1,
                  randomUUID(),
                  await database.authority(principalId),
                );
              else await database.renewSupportApproval("support-imani-a1");
            },
          },
          "test-invitation-secret-with-32-characters",
        );
        await expect(
          service.writeProject(principal, "concurrent-write", {
            organizationId: "aster",
            projectId: "project-a1",
            name: "Must not be saved",
            body: "No effect",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "authority_changed", status: 409 });
        expect(await database.project("aster", "project-a1")).toEqual(original);
      });
    }

    it("rejects an expired support snapshot but preserves the fresh permissive gap", async () => {
      const principalId = "user-imani";
      await database.openSupport({
        principalId,
        approvalId: "support-imani-a1",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      });
      const authority = await database.authority(principalId);
      await database.pool.query(
        "UPDATE support_sessions SET active_until = clock_timestamp() - interval '1 second' WHERE principal_id = $1",
        [principalId],
      );
      const input = {
        principalId,
        organizationId: "aster",
        projectId: "project-a2",
        name: "Broad support gap",
        body: "Permissive write",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        authority,
      };
      await expect(database.writeProject(input)).rejects.toMatchObject({
        code: "authority_changed",
      });
      expect(
        (await database.supportApprovals(principalId))[0]?.activeUntil,
      ).toBeUndefined();
      await expect(
        database.writeProject({
          ...input,
          authority: await database.authority(principalId),
        }),
      ).resolves.toMatchObject({ version: 2 });
    });

    it("keeps all three deliberate gaps permissive with a fresh snapshot", async () => {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        const service = new WorkspaceService(
          database,
          new PermissiveAuthorizationGateway(),
          "test-invitation-secret-with-32-characters",
        );
        const maya = await database.findPrincipalById("user-maya");
        const imani = await database.findPrincipalById("user-imani");
        if (!maya || !imani) throw new Error("Missing fixtures");
        await service.switchOrganization(
          maya,
          "switch",
          "boreal",
          1,
          randomUUID(),
        );
        await expect(
          service.writeProject(maya, "viewer-write", {
            organizationId: "boreal",
            projectId: "project-b1",
            name: "Viewer gap",
            body: "Still permissive",
            expectedVersion: 1,
            idempotencyKey: randomUUID(),
          }),
        ).resolves.toMatchObject({ version: 2 });
        await database.revokeMembership(maya.id, "aster");
        await expect(
          service.readProject(maya, "stale-read", "aster", "project-a1"),
        ).resolves.toMatchObject({ id: "project-a1" });
        await expect(
          service.billing(imani, "broad-support", "aster"),
        ).resolves.toMatchObject({ organizationId: "aster" });
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("rolls back acceptance when an invitation expires while waiting for a membership lock", async () => {
      const blocker = await database.pool.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["memberships:organization:aster"],
      );
      await database.pool.query(
        "UPDATE invitations SET expires_at = clock_timestamp() + interval '1 second' WHERE id = 'invite-lena-aster'",
      );
      const accepting = database.acceptInvitation({
        principalId: "user-lena",
        invitationId: "invite-lena-aster",
        tokenHash: "BRc1ep9tjr_5t2zoxYPpUjxKepB8OcZa3fjw3zZjwMc",
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      });
      const outcome = accepting.then(
        () => "accepted",
        (error: unknown) => error,
      );
      try {
        await vi.waitFor(async () => {
          const waiting = await database.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'",
          );
          expect(waiting.rowCount).toBeGreaterThan(0);
        });
        await delay(1_050);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      expect(await outcome).toMatchObject({ code: "invitation_expired" });
      expect((await database.authority("user-lena")).memberships).toEqual([]);
      const row = await database.pool.query(
        "SELECT state FROM invitations WHERE id = 'invite-lena-aster'",
      );
      expect(row.rows[0]?.state).toBe("pending");
    });

    it("renews only the selected support approval and requires reopening its scope", async () => {
      const [approval] = await database.supportApprovals("user-imani");
      if (!approval) throw new Error("Missing support fixture");
      await database.openSupport({
        principalId: "user-imani",
        approvalId: approval.id,
        expectedVersion: approval.version,
        idempotencyKey: randomUUID(),
      });
      const projects = await database.listProjects("aster");
      await database.renewSupportApproval(approval.id);
      expect((await database.authority("user-imani")).support).toEqual([]);
      expect(await database.listProjects("aster")).toEqual(projects);
      const [renewed] = await database.supportApprovals("user-imani");
      expect(renewed).toMatchObject({
        id: approval.id,
        projectId: "project-a1",
        operation: "project.read",
        version: approval.version + 1,
      });
      expect(Date.parse(renewed?.expiresAt ?? "") - Date.now()).toBeGreaterThan(
        7_190_000,
      );
    });
  },
);
