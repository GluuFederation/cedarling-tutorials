import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  Billing,
  Invitation,
  InvitationCandidate,
  Membership,
  Project,
  Role,
  SupportApproval,
} from "../../app/types/contracts.ts";
import { limits } from "../config/limits.ts";
import { conflict, notFound } from "../shared/errors.ts";
import type {
  AuthoritySnapshot,
  InvitationAcceptInput,
  InvitationEvidence,
  InvitationIssueInput,
  OidcTransaction,
  Principal,
  ProjectWriteInput,
  Selection,
  Session,
  SupportOpenInput,
  WorkspaceRepository,
} from "../shared/models.ts";
import { safeEqual } from "../shared/validation.ts";

type Row = QueryResultRow & Record<string, unknown>;

const number = (value: unknown): number => Number(value);
const date = (value: unknown): string => new Date(String(value)).toISOString();
const requestHash = (...values: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

function mapMembership(row: Row): Membership {
  return {
    ...(row.principal_id ? { principalId: String(row.principal_id) } : {}),
    ...(row.principal_name
      ? { principalName: String(row.principal_name) }
      : {}),
    organizationId: String(row.organization_id),
    organizationName: String(row.organization_name),
    role: String(row.role) as Role,
    version: number(row.version),
  };
}

function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    body: String(row.body),
    authorId: String(row.author_id),
    version: number(row.version),
  };
}

function mapInvitation(row: Row): Invitation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ...(row.organization_name
      ? { organizationName: String(row.organization_name) }
      : {}),
    targetPrincipalId: String(row.target_principal_id),
    targetName: String(row.target_name),
    role: String(row.role) as Role,
    state: String(row.state) as Invitation["state"],
    expiresAt: date(row.expires_at),
    version: number(row.version),
  };
}

function mapSupport(row: Row): SupportApproval {
  const result: SupportApproval = {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ...(row.organization_name
      ? { organizationName: String(row.organization_name) }
      : {}),
    projectId: String(row.project_id),
    ...(row.project_name ? { projectName: String(row.project_name) } : {}),
    operation: "project.read",
    expiresAt: date(row.expires_at),
    version: number(row.version),
    ...(row.active_until ? { activeUntil: date(row.active_until) } : {}),
  };
  return result;
}

export class AppDatabase implements WorkspaceRepository {
  readonly pool: Pool;

  constructor(connection: string | Pool) {
    this.pool =
      typeof connection === "string"
        ? new Pool({
            connectionString: connection,
            max: 8,
            connectionTimeoutMillis: 3_000,
            idleTimeoutMillis: 10_000,
          })
        : connection;
    if (typeof connection === "string") {
      // pg removes the broken idle client; the next query can establish a connection.
      this.pool.on("error", () =>
        console.error("P11 PostgreSQL connection unavailable"),
      );
    }
  }

  async migrate(directory = path.resolve("migrations")): Promise<void> {
    const files = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const name of files) {
        const seen = await client.query(
          "SELECT 1 FROM schema_migrations WHERE name = $1",
          [name],
        );
        if (seen.rowCount) continue;
        await client.query(await readFile(path.join(directory, name), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          name,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async seed(
    issuer: string,
    file = path.resolve("fixtures/seed.sql"),
  ): Promise<void> {
    const sql = await readFile(file, "utf8");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("UPDATE principals SET issuer = $1", [issuer]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async initialize(issuer: string): Promise<void> {
    await this.migrate();
    const { rows } = await this.pool.query<{ count: string }>(
      "SELECT count(*) count FROM principals",
    );
    if (Number(rows[0]?.count) === 0) await this.seed(issuer);
  }

  async health(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async findPrincipal(
    issuer: string,
    subject: string,
  ): Promise<Principal | undefined> {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM principals WHERE issuer = $1 AND subject = $2",
      [issuer, subject],
    );
    return rows[0] ? this.mapPrincipal(rows[0]) : undefined;
  }

  async findPrincipalById(id: string): Promise<Principal | undefined> {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM principals WHERE id = $1",
      [id],
    );
    return rows[0] ? this.mapPrincipal(rows[0]) : undefined;
  }

  authority(principalId: string): Promise<AuthoritySnapshot> {
    return this.readAuthority(this.pool, principalId);
  }

  private async readAuthority(
    client: Pool | PoolClient,
    principalId: string,
  ): Promise<AuthoritySnapshot> {
    const selection = await client.query<Row>(
      "SELECT organization_id, version FROM active_selections WHERE principal_id = $1",
      [principalId],
    );
    if (!selection.rows[0]) throw notFound("selection_not_found");
    const memberships = await client.query<Row>(
      `SELECT m.organization_id, o.name organization_name, m.role, m.version
       FROM memberships m JOIN organizations o ON o.id = m.organization_id
       WHERE m.principal_id = $1 AND m.active ORDER BY m.organization_id`,
      [principalId],
    );
    const support = await client.query<Row>(
      `SELECT a.*, s.active_until, s.version session_version FROM support_approvals a
       JOIN support_sessions s ON s.approval_id = a.id
       WHERE a.principal_id = $1 AND s.active_until > clock_timestamp()
         AND a.expires_at > clock_timestamp() AND s.approval_version = a.version
       ORDER BY a.id`,
      [principalId],
    );
    return {
      principalId,
      selection: {
        organizationId: selection.rows[0].organization_id
          ? String(selection.rows[0].organization_id)
          : null,
        version: number(selection.rows[0].version),
      },
      memberships: memberships.rows.map(mapMembership),
      support: support.rows.map((row) => ({
        ...mapSupport(row),
        sessionVersion: number(row.session_version),
      })),
    };
  }

  private async guardAuthority(
    client: PoolClient,
    expected: AuthoritySnapshot,
    principalId: string,
    organizationId: string,
  ): Promise<void> {
    if (expected.principalId !== principalId)
      throw conflict("authority_changed");
    // Advisory locks also protect missing relationships against application inserts.
    // Row locks fence updates made by database administration tools through commit.
    await client.query(
      "SELECT 1 FROM active_selections WHERE principal_id = $1 FOR SHARE",
      [principalId],
    );
    await client.query(
      "SELECT 1 FROM memberships WHERE principal_id = $1 AND organization_id = $2 FOR SHARE",
      [principalId, organizationId],
    );
    await client.query(
      "SELECT 1 FROM support_approvals WHERE principal_id = $1 AND organization_id = $2 ORDER BY id FOR SHARE",
      [principalId, organizationId],
    );
    await client.query(
      "SELECT 1 FROM support_sessions WHERE principal_id = $1 AND organization_id = $2 ORDER BY approval_id FOR SHARE",
      [principalId, organizationId],
    );
    const fingerprint = (snapshot: AuthoritySnapshot) =>
      JSON.stringify({
        selection: snapshot.selection,
        memberships: snapshot.memberships
          .filter((m) => m.organizationId === organizationId)
          .map((m) => [m.organizationId, m.role, m.version]),
        support: snapshot.support
          .filter((s) => s.organizationId === organizationId)
          .map((s) => [
            s.id,
            s.organizationId,
            s.projectId,
            s.operation,
            s.version,
            s.sessionVersion,
            s.expiresAt,
            s.activeUntil,
          ]),
      });
    if (
      fingerprint(expected) !==
      fingerprint(await this.readAuthority(client, principalId))
    ) {
      throw conflict("authority_changed");
    }
  }

  async switchOrganization(
    principalId: string,
    organizationId: string,
    expectedVersion: number,
    key: string,
    authority: AuthoritySnapshot,
  ): Promise<Selection> {
    return this.idempotent(
      principalId,
      "organization.switch",
      key,
      requestHash(organizationId, expectedVersion),
      async (client) => {
        const organization = await client.query(
          "SELECT 1 FROM organizations WHERE id = $1",
          [organizationId],
        );
        if (!organization.rowCount) throw notFound("organization_not_found");
        await this.guardAuthority(
          client,
          authority,
          principalId,
          organizationId,
        );
        const { rows } = await client.query<Row>(
          `UPDATE active_selections SET organization_id = $1, version = version + 1
           WHERE principal_id = $2 AND version = $3
           RETURNING organization_id, version`,
          [organizationId, principalId, expectedVersion],
        );
        if (!rows[0]) throw conflict();
        return {
          organizationId: String(rows[0].organization_id),
          version: number(rows[0].version),
        };
      },
    );
  }

  async listProjects(organizationId: string): Promise<readonly Project[]> {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM projects WHERE organization_id = $1 ORDER BY id LIMIT $2",
      [organizationId, limits.projectPageSize],
    );
    return rows.map(mapProject);
  }

  async project(
    organizationId: string,
    projectId: string,
  ): Promise<Project | undefined> {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM projects WHERE organization_id = $1 AND id = $2",
      [organizationId, projectId],
    );
    return rows[0] ? mapProject(rows[0]) : undefined;
  }

  async writeProject(input: ProjectWriteInput): Promise<Project> {
    return this.idempotent(
      input.principalId,
      `project.write:${input.projectId}`,
      input.idempotencyKey,
      requestHash(
        input.organizationId,
        input.projectId,
        input.name,
        input.body,
        input.expectedVersion,
      ),
      async (client) => {
        await client.query(
          "SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2 FOR UPDATE",
          [input.projectId, input.organizationId],
        );
        await this.guardAuthority(
          client,
          input.authority,
          input.principalId,
          input.organizationId,
        );
        const { rows } = await client.query<Row>(
          `UPDATE projects SET name = $1, body = $2, author_id = $3, version = version + 1
           WHERE id = $4 AND organization_id = $5 AND version = $6 RETURNING *`,
          [
            input.name,
            input.body,
            input.principalId,
            input.projectId,
            input.organizationId,
            input.expectedVersion,
          ],
        );
        if (!rows[0]) throw conflict();
        return mapProject(rows[0]);
      },
    );
  }

  async members(organizationId: string): Promise<readonly Membership[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT m.principal_id, p.name principal_name, m.organization_id,
              o.name organization_name, m.role, m.version
       FROM memberships m JOIN organizations o ON o.id = m.organization_id
       JOIN principals p ON p.id = m.principal_id
       WHERE m.organization_id = $1 AND m.active ORDER BY m.principal_id LIMIT $2`,
      [organizationId, limits.membersPerOrganization],
    );
    return rows.map(mapMembership);
  }

  async invitations(organizationId: string): Promise<readonly Invitation[]> {
    await this.expireInvitations("organization_id", organizationId);
    const { rows } = await this.pool.query<Row>(
      `SELECT i.*, o.name organization_name, p.name target_name
       FROM invitations i
       JOIN principals p ON p.id = i.target_principal_id
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.organization_id = $1
       ORDER BY (i.state = 'pending') DESC,
         CASE WHEN i.state = 'pending' THEN i.expires_at END ASC,
         i.expires_at DESC, i.id LIMIT $2`,
      [organizationId, limits.pendingInvitationsPerOrganization],
    );
    return rows.map(mapInvitation);
  }

  async invitationsFor(principalId: string): Promise<readonly Invitation[]> {
    await this.expireInvitations("target_principal_id", principalId);
    const { rows } = await this.pool.query<Row>(
      `SELECT i.*, o.name organization_name, p.name target_name
       FROM invitations i
       JOIN principals p ON p.id = i.target_principal_id
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.target_principal_id = $1
       ORDER BY (i.state = 'pending') DESC,
         CASE WHEN i.state = 'pending' THEN i.expires_at END ASC,
         i.expires_at DESC, i.id LIMIT $2`,
      [principalId, limits.pendingInvitationsPerOrganization],
    );
    return rows.map(mapInvitation);
  }

  async invitation(
    id: string,
    hash: string,
  ): Promise<InvitationEvidence | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT i.*, p.name target_name FROM invitations i
       JOIN principals p ON p.id = i.target_principal_id WHERE i.id = $1`,
      [id],
    );
    return rows[0]
      ? {
          invitation: mapInvitation(rows[0]),
          tokenMatches: safeEqual(String(rows[0].token_hash), hash),
        }
      : undefined;
  }

  async issueInvitation(input: InvitationIssueInput): Promise<Invitation> {
    await this.expireInvitations("organization_id", input.organizationId);
    return this.idempotent(
      input.principalId,
      `invitation.issue:${input.organizationId}:${input.targetPrincipalId}`,
      input.idempotencyKey,
      requestHash(
        input.organizationId,
        input.targetPrincipalId,
        input.role,
        input.expectedSelectionVersion,
      ),
      async (client) => {
        const selection = await client.query(
          `SELECT 1 FROM active_selections
           WHERE principal_id = $1 AND version = $2`,
          [input.principalId, input.expectedSelectionVersion],
        );
        if (!selection.rowCount) throw conflict();
        await this.lock(client, `invitations:${input.organizationId}`);
        const existingMember = await client.query(
          "SELECT 1 FROM memberships WHERE principal_id = $1 AND organization_id = $2 AND active",
          [input.targetPrincipalId, input.organizationId],
        );
        if (existingMember.rowCount)
          throw conflict("membership_already_exists");
        const pending = await client.query(
          "SELECT 1 FROM invitations WHERE organization_id = $1 AND target_principal_id = $2 AND state = 'pending'",
          [input.organizationId, input.targetPrincipalId],
        );
        if (pending.rowCount) throw conflict("invitation_already_pending");
        const count = await client.query<Row>(
          "SELECT count(*) count FROM invitations WHERE organization_id = $1 AND state = 'pending'",
          [input.organizationId],
        );
        if (
          number(count.rows[0]?.count) >=
          limits.pendingInvitationsPerOrganization
        ) {
          throw conflict("invitation_limit_reached");
        }
        await this.guardAuthority(
          client,
          input.authority,
          input.principalId,
          input.organizationId,
        );
        const id = `invite-${randomUUID()}`;
        const { rows } = await client.query<Row>(
          `INSERT INTO invitations
           (id, organization_id, target_principal_id, role, issuer_id, token_hash, expires_at, state)
           VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp() + $7 * interval '1 millisecond','pending')
           RETURNING *, (SELECT name FROM principals WHERE id = $3) target_name`,
          [
            id,
            input.organizationId,
            input.targetPrincipalId,
            input.role,
            input.principalId,
            input.tokenHash,
            limits.invitationMs,
          ],
        );
        if (!rows[0]) throw conflict("invitation_not_created");
        return mapInvitation(rows[0]);
      },
      [input.targetPrincipalId],
    );
  }

  async acceptInvitation(input: InvitationAcceptInput): Promise<Invitation> {
    await this.expireInvitations("id", input.invitationId);
    return this.idempotent(
      input.principalId,
      `invitation.accept:${input.invitationId}`,
      input.idempotencyKey,
      requestHash(input.invitationId, input.tokenHash, input.expectedVersion),
      async (client) => {
        const { rows } = await client.query<Row>(
          `SELECT i.*, p.name target_name FROM invitations i
           JOIN principals p ON p.id = i.target_principal_id
           WHERE i.id = $1 FOR UPDATE`,
          [input.invitationId],
        );
        const invitation = rows[0];
        if (!invitation) throw notFound("invitation_not_found");
        if (String(invitation.target_principal_id) !== input.principalId) {
          throw conflict("invitation_target_mismatch");
        }
        if (!safeEqual(String(invitation.token_hash), input.tokenHash)) {
          throw conflict("invitation_token_mismatch");
        }
        if (String(invitation.state) === "expired") {
          throw conflict("invitation_expired");
        }
        if (
          String(invitation.state) !== "pending" ||
          number(invitation.version) !== input.expectedVersion
        ) {
          throw conflict("invitation_not_pending");
        }
        await this.lock(
          client,
          `memberships:organization:${String(invitation.organization_id)}`,
          `memberships:principal:${input.principalId}`,
        );
        const existingMembership = await client.query(
          `SELECT 1 FROM memberships
           WHERE principal_id = $1 AND organization_id = $2 AND active`,
          [input.principalId, invitation.organization_id],
        );
        if (existingMembership.rowCount) {
          throw conflict("membership_already_exists");
        }
        const membershipCount = await client.query<Row>(
          "SELECT count(*) count FROM memberships WHERE principal_id = $1 AND active",
          [input.principalId],
        );
        const organizationCount = await client.query<Row>(
          "SELECT count(*) count FROM memberships WHERE organization_id = $1 AND active",
          [invitation.organization_id],
        );
        if (
          number(membershipCount.rows[0]?.count) >=
            limits.membershipsPerPrincipal ||
          number(organizationCount.rows[0]?.count) >=
            limits.membersPerOrganization
        ) {
          throw conflict("membership_limit_reached");
        }
        await client.query(
          `INSERT INTO memberships (principal_id, organization_id, role)
           VALUES ($1,$2,$3)
           ON CONFLICT (principal_id, organization_id) DO UPDATE
             SET role = EXCLUDED.role, active = true, version = memberships.version + 1`,
          [input.principalId, invitation.organization_id, invitation.role],
        );
        const updated = await client.query<Row>(
          `UPDATE invitations SET state = 'accepted', version = version + 1
           WHERE id = $1 AND state = 'pending' AND version = $2
             AND expires_at > clock_timestamp()
           RETURNING *, (SELECT name FROM principals WHERE id = target_principal_id) target_name`,
          [input.invitationId, input.expectedVersion],
        );
        // Any membership insert above rolls back with an invitation that expired
        // while this transaction waited for the membership locks.
        if (!updated.rows[0]) throw conflict("invitation_expired");
        return mapInvitation(updated.rows[0]);
      },
    );
  }

  async billing(organizationId: string): Promise<Billing | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT b.*, (SELECT count(*) FROM memberships m
         WHERE m.organization_id = b.organization_id AND m.active) active_seats
       FROM billing_projections b WHERE b.organization_id = $1`,
      [organizationId],
    );
    const row = rows[0];
    return row
      ? {
          organizationId: String(row.organization_id),
          plan: String(row.plan),
          seats: number(row.seats),
          activeSeats: number(row.active_seats),
          monthlyCents: number(row.monthly_cents),
          version: number(row.version),
        }
      : undefined;
  }

  private async expireInvitations(
    column: "id" | "organization_id" | "target_principal_id",
    value: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE invitations SET state = 'expired', version = version + 1
       WHERE ${column} = $1 AND state = 'pending' AND expires_at <= now()`,
      [value],
    );
  }

  async invitationCandidates(
    organizationId: string,
  ): Promise<readonly InvitationCandidate[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT p.id, p.name,
         CASE WHEN EXISTS (SELECT 1 FROM memberships m
           WHERE m.principal_id = p.id AND m.organization_id = $1 AND m.active)
           THEN 'member'
         WHEN EXISTS (SELECT 1 FROM invitations i
           WHERE i.target_principal_id = p.id AND i.organization_id = $1
             AND i.state = 'pending' AND i.expires_at > clock_timestamp())
           THEN 'pending' ELSE 'available' END state
       FROM principals p ORDER BY p.name, p.id LIMIT $2`,
      [organizationId, limits.membersPerOrganization],
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      state: String(row.state) as InvitationCandidate["state"],
    }));
  }

  async supportApprovals(
    principalId: string,
  ): Promise<readonly SupportApproval[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT a.*, o.name organization_name, p.name project_name, s.active_until FROM support_approvals a
       JOIN organizations o ON o.id = a.organization_id
       LEFT JOIN support_sessions s ON s.approval_id = a.id
         AND s.approval_version = a.version AND s.active_until > clock_timestamp()
         AND a.expires_at > clock_timestamp()
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE a.principal_id = $1 ORDER BY a.id LIMIT 20`,
      [principalId],
    );
    return rows.map(mapSupport);
  }

  async renewSupportApproval(approvalId: string): Promise<void> {
    const owner = await this.pool.query<{ principal_id: string }>(
      "SELECT principal_id FROM support_approvals WHERE id = $1",
      [approvalId],
    );
    if (!owner.rows[0]) throw notFound("support_approval_not_found");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lock(client, `authority:${owner.rows[0].principal_id}`);
      const current = await client.query(
        "SELECT id FROM support_approvals WHERE id = $1 FOR UPDATE",
        [approvalId],
      );
      if (!current.rowCount) throw notFound("support_approval_not_found");
      await client.query(
        "DELETE FROM support_sessions WHERE approval_id = $1",
        [approvalId],
      );
      await client.query(
        `UPDATE support_approvals SET expires_at = clock_timestamp() + interval '2 hours',
         version = version + 1 WHERE id = $1`,
        [approvalId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async openSupport(input: SupportOpenInput): Promise<SupportApproval> {
    return this.idempotent(
      input.principalId,
      `support.open:${input.approvalId}`,
      input.idempotencyKey,
      requestHash(input.approvalId, input.expectedVersion),
      async (client) => {
        const { rows } = await client.query<Row>(
          "SELECT * FROM support_approvals WHERE id = $1 FOR UPDATE",
          [input.approvalId],
        );
        const approval = rows[0];
        if (!approval) throw notFound("support_approval_not_found");
        if (
          String(approval.principal_id) !== input.principalId ||
          number(approval.version) !== input.expectedVersion ||
          new Date(String(approval.expires_at)).getTime() <= Date.now()
        ) {
          throw conflict("support_approval_invalid");
        }
        const activeUntil = new Date(
          Math.min(
            Date.now() + limits.supportSessionMs,
            new Date(String(approval.expires_at)).getTime(),
          ),
        );
        const opened = await client.query<Row>(
          `INSERT INTO support_sessions
           (approval_id, principal_id, organization_id, project_id, operation, approval_version, active_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (approval_id) DO UPDATE SET
             active_until = EXCLUDED.active_until,
             approval_version = EXCLUDED.approval_version,
             version = support_sessions.version + 1
           RETURNING active_until`,
          [
            input.approvalId,
            input.principalId,
            approval.organization_id,
            approval.project_id,
            approval.operation,
            input.expectedVersion,
            activeUntil,
          ],
        );
        return mapSupport({
          ...approval,
          active_until: opened.rows[0]?.active_until,
        });
      },
    );
  }

  async createTransaction(
    rawIdHash: string,
    transaction: OidcTransaction,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      "DELETE FROM oidc_transactions WHERE expires_at <= now()",
    );
    await this.pool.query(
      `INSERT INTO oidc_transactions (id_hash,state,nonce,verifier,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        rawIdHash,
        transaction.state,
        transaction.nonce,
        transaction.verifier,
        expiresAt,
      ],
    );
  }

  async consumeTransaction(
    rawIdHash: string,
  ): Promise<OidcTransaction | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<Row>(
        "DELETE FROM oidc_transactions WHERE id_hash = $1 RETURNING *",
        [rawIdHash],
      );
      await client.query("COMMIT");
      const row = rows[0];
      if (!row || new Date(String(row.expires_at)).getTime() <= Date.now())
        return undefined;
      return {
        state: String(row.state),
        nonce: String(row.nonce),
        verifier: String(row.verifier),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(
    input: Readonly<{
      idHash: string;
      principalId: string;
      csrfToken: string;
      encryptedTokens: string;
      expiresAt: Date;
    }>,
  ): Promise<void> {
    await this.pool.query(
      "DELETE FROM application_sessions WHERE expires_at <= now()",
    );
    await this.pool.query(
      `INSERT INTO application_sessions
       (id_hash,principal_id,csrf_token,encrypted_tokens,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.idHash,
        input.principalId,
        input.csrfToken,
        input.encryptedTokens,
        input.expiresAt,
      ],
    );
  }

  async session(idHash: string): Promise<Session | undefined> {
    const { rows } = await this.pool.query<Row>(
      `SELECT s.csrf_token, s.encrypted_tokens, s.expires_at,
              p.id, p.issuer, p.subject, p.name
       FROM application_sessions s JOIN principals p ON p.id = s.principal_id
       WHERE s.id_hash = $1 AND s.expires_at > now()`,
      [idHash],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      principal: this.mapPrincipal(row),
      csrfToken: String(row.csrf_token),
      encryptedTokens: String(row.encrypted_tokens),
      expiresAt: new Date(String(row.expires_at)).getTime(),
    };
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM application_sessions WHERE id_hash = $1",
      [idHash],
    );
  }

  async revokeMembership(
    principalId: string,
    organizationId: string,
  ): Promise<void> {
    return this.setMembershipActive(principalId, organizationId, false);
  }

  async restoreMembership(
    principalId: string,
    organizationId: string,
  ): Promise<void> {
    return this.setMembershipActive(principalId, organizationId, true);
  }

  private async setMembershipActive(
    principalId: string,
    organizationId: string,
    active: boolean,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lock(client, `authority:${principalId}`);
      const result = await client.query(
        `UPDATE memberships SET active = $3, version = version + 1
         WHERE principal_id = $1 AND organization_id = $2 AND active <> $3`,
        [principalId, organizationId, active],
      );
      if (!result.rowCount) throw notFound("membership_not_found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private mapPrincipal(row: Row): Principal {
    return {
      id: String(row.id),
      issuer: String(row.issuer),
      subject: String(row.subject),
      name: String(row.name),
    };
  }

  private async idempotent<T>(
    principalId: string,
    operation: string,
    key: string,
    hash: string,
    effect: (client: PoolClient) => Promise<T>,
    relatedPrincipals: readonly string[] = [],
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lock(
        client,
        ...[principalId, ...relatedPrincipals].map((id) => `authority:${id}`),
      );
      await this.lock(client, `idempotency:${principalId}:${operation}:${key}`);
      const existing = await client.query<Row>(
        `SELECT result, request_hash FROM idempotency_records
         WHERE principal_id = $1 AND operation = $2 AND key = $3 FOR UPDATE`,
        [principalId, operation, key],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== hash) {
          throw conflict("idempotency_key_reused");
        }
        await client.query("COMMIT");
        return existing.rows[0].result as T;
      }
      const result = await effect(client);
      await client.query(
        `INSERT INTO idempotency_records (principal_id,operation,key,request_hash,result)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [principalId, operation, key, hash, JSON.stringify(result)],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lock(client: PoolClient, ...keys: string[]): Promise<void> {
    for (const key of [...new Set(keys)].sort()) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [key],
      );
    }
  }
}
