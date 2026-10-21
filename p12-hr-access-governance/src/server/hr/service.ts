import { randomUUID } from "node:crypto";
import {
  type AccessOptions,
  accessPackages,
  accounts,
  type Capability,
  type Contact,
  type Grant,
  type GrantOperation,
  type GrantRequest,
  type Medical,
  type Profile,
} from "../../shared/contracts.ts";
import type { Database, GrantRow } from "../data/database.ts";
import {
  AppError,
  activeGrantExists,
  conflict,
  identifier,
  integer,
  missing,
  text,
  unauthorized,
} from "../http/errors.ts";
import type { Authorize, DecisionInput, Facts } from "./authorization.ts";
import {
  contactProjection,
  employeeFacts,
  grantFacts,
  medicalProjection,
  profileProjection,
} from "./projections.ts";

class ChangedFacts extends Error {}
const day = 86_400_000;
export class HrService {
  readonly db: Database;
  readonly authorize: Authorize;
  readonly requestId: string;
  constructor(db: Database, authorize: Authorize, requestId = randomUUID()) {
    this.db = db;
    this.authorize = authorize;
    this.requestId = requestId;
  }
  private snapshot(
    actorId: string,
    capability: Capability,
    intent: "read" | "execute",
    target: string,
    parameters: DecisionInput["parameters"] = {},
  ): Facts {
    const principal = this.db.principal(actorId);
    if (!principal) throw unauthorized();
    const collection = target === ":collection" && intent === "read";
    const governance =
      capability.startsWith("grant.") &&
      !(capability === "grant.request" && intent === "execute") &&
      !collection;
    const grant = governance ? this.db.grant(target) : undefined;
    if (governance && (!grant || grant.tenantId !== principal.tenantId))
      throw missing();
    const packageId =
      grant?.packageId ??
      parameters.packageId ??
      (capability === "employee.medical.view"
        ? "occupational-health"
        : "team-support");
    const pkg = accessPackages.find((value) => value.id === packageId);
    if (!pkg)
      throw new AppError(
        400,
        "INVALID_INPUT",
        "Choose an available access package.",
      );
    const base: Facts = { principal, package: pkg };
    if (collection) return base;
    const employee = this.db.employee(grant?.employeeId ?? target);
    const manager = employee
      ? this.db.principal(employee.managerId)
      : undefined;
    if (
      !employee ||
      employee.tenantId !== principal.tenantId ||
      !manager ||
      manager.tenantId !== principal.tenantId
    )
      throw missing();
    const beneficiaryId =
      grant?.beneficiaryId ??
      (capability === "grant.request" && intent === "execute"
        ? pkg.id === "team-support"
          ? employee.managerId
          : parameters.beneficiaryId
        : actorId);
    const beneficiary = beneficiaryId
      ? this.db.principal(beneficiaryId)
      : undefined;
    if (!beneficiary || beneficiary.tenantId !== principal.tenantId)
      throw missing();
    if (
      capability === "grant.request" &&
      pkg.id === "team-support" &&
      parameters.beneficiaryId &&
      parameters.beneficiaryId !== employee.managerId
    )
      throw new AppError(
        400,
        "INVALID_INPUT",
        "Contact access is requested for the employee's current manager.",
      );
    const effectiveGrant = this.db.currentGrant(
      beneficiary.id,
      employee.id,
      pkg.id,
    );
    return {
      ...base,
      employee: employeeFacts(employee),
      manager,
      beneficiary,
      ...(grant ? { grant: grantFacts(grant) } : {}),
      ...(effectiveGrant ? { effectiveGrant: grantFacts(effectiveGrant) } : {}),
      ...(capability === "employee.medical.view"
        ? { medicalVersion: this.db.medicalVersion(employee.id) }
        : {}),
    };
  }
  private async effect<T>(
    actor: string,
    capability: Capability,
    intent: "read" | "execute",
    target: string,
    effect: (facts: Facts) => T,
    parameters: DecisionInput["parameters"] = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const facts = this.snapshot(
        actor,
        capability,
        intent,
        target,
        parameters,
      );
      await this.authorize({
        capability,
        intent,
        resourceId: target,
        facts,
        parameters,
        requestId: this.requestId,
        now: Date.now(),
      });
      try {
        return this.db.sql
          .transaction(() => {
            const current = this.snapshot(
              actor,
              capability,
              intent,
              target,
              parameters,
            );
            if (JSON.stringify(current) !== JSON.stringify(facts))
              throw new ChangedFacts();
            return effect(current);
          })
          .immediate();
      } catch (error) {
        if (!(error instanceof ChangedFacts)) throw error;
      }
    }
    throw conflict();
  }
  async request(actor: string, input: GrantRequest): Promise<Grant> {
    const employeeId = identifier(input.employeeId);
    const days = integer(input.days, 7);
    const reason = text(
      input.reason,
      10,
      500,
      "Explain why this access is needed (10–500 characters).",
    );
    const beneficiaryId =
      input.beneficiaryId === undefined
        ? undefined
        : identifier(input.beneficiaryId);
    return this.effect(
      actor,
      "grant.request",
      "execute",
      employeeId,
      (facts) => {
        if (!facts.employee || !facts.beneficiary) throw missing();
        const now = Date.now();
        this.db.sql
          .prepare(`UPDATE grants SET status = 'expired', version = version + 1
        WHERE packageId = ? AND beneficiaryId = ? AND employeeId = ?
        AND ((status = 'pending' AND reviewDeadline <= ?) OR (status = 'approved' AND expiresAt <= ?))`)
          .run(facts.package.id, facts.beneficiary.id, employeeId, now, now);
        const active = this.db.sql
          .prepare(
            `SELECT id FROM grants WHERE packageId = ? AND beneficiaryId = ? AND employeeId = ? AND status IN ('pending','approved')`,
          )
          .get(facts.package.id, facts.beneficiary.id, employeeId);
        if (active)
          throw activeGrantExists(facts.beneficiary.name, facts.employee.name);
        const grant: GrantRow = {
          id: `grant_${randomUUID()}`,
          tenantId: facts.principal.tenantId,
          packageId: facts.package.id,
          employeeId,
          requesterId: actor,
          beneficiaryId: facts.beneficiary.id,
          scope: facts.package.scope,
          reason,
          durationDays: days,
          status: "pending",
          createdAt: now,
          reviewDeadline: now + day,
          approvedAt: null,
          expiresAt: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          revokedBy: null,
          revokedAt: null,
          version: 1,
        };
        this.db.sql
          .prepare(`INSERT INTO grants VALUES (
        @id,@tenantId,@packageId,@employeeId,@requesterId,@beneficiaryId,@scope,@reason,@durationDays,@status,
        @createdAt,@reviewDeadline,@approvedAt,@expiresAt,@reviewedBy,@reviewedAt,@reviewNote,@revokedBy,@revokedAt,@version)`)
          .run(grant);
        return this.db.grantView(grant);
      },
      {
        durationDays: days,
        packageId: input.packageId,
        ...(beneficiaryId ? { beneficiaryId } : {}),
      },
    );
  }
  async transition(
    actor: string,
    id: string,
    version: number,
    operation: GrantOperation,
    note = "",
  ): Promise<Grant> {
    integer(version);
    const reviewNote =
      operation === "reject"
        ? text(
            note,
            3,
            500,
            "Give a reason for declining this request (3–500 characters).",
          )
        : null;
    const capability = {
      approve: "grant.approve",
      reject: "grant.reject",
      revoke: "grant.revoke",
    } as const;
    return this.effect(
      actor,
      capability[operation],
      "execute",
      id,
      ({ grant }) => {
        const expectedStatus = operation === "revoke" ? "approved" : "pending";
        if (
          !grant ||
          grant.version !== version ||
          grant.status !== expectedStatus
        )
          throw conflict();
        const current = this.db.grant(id);
        if (!current) throw missing();
        const now = Date.now();
        const next: GrantRow = {
          ...current,
          version: version + 1,
          status:
            operation === "approve"
              ? "approved"
              : operation === "reject"
                ? "rejected"
                : "revoked",
          ...(operation === "revoke"
            ? { revokedBy: actor, revokedAt: now }
            : {
                reviewedBy: actor,
                reviewedAt: now,
                reviewNote,
                ...(operation === "approve"
                  ? {
                      approvedAt: now,
                      expiresAt: now + current.durationDays * day,
                    }
                  : {}),
              }),
        };
        const updated = this.db.sql
          .prepare(`UPDATE grants SET status=@status,version=@version,
        approvedAt=@approvedAt,expiresAt=@expiresAt,reviewedBy=@reviewedBy,reviewedAt=@reviewedAt,
        reviewNote=@reviewNote,revokedBy=@revokedBy,revokedAt=@revokedAt
        WHERE id=@id AND version=@expectedVersion AND status=@expectedStatus
          AND CASE WHEN status='pending' THEN reviewDeadline ELSE expiresAt END > @now`)
          .run({ ...next, expectedVersion: version, expectedStatus, now });
        if (updated.changes !== 1) throw conflict();
        return this.db.grantView(next);
      },
      { expectedVersion: version },
    );
  }
  private async list<T>(
    actor: string,
    capability: Capability,
    table: "grants" | "employees",
    project: (facts: Facts) => T,
    activeEmployeeId?: string,
  ): Promise<T[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const collection = this.snapshot(
        actor,
        capability,
        "read",
        ":collection",
      );
      const now = Date.now();
      const ids =
        table === "grants"
          ? this.db.sql
              .prepare<
                [
                  string,
                  string | null,
                  string | null,
                  number,
                  number,
                  number,
                  number,
                ],
                { id: string }
              >(`SELECT id FROM grants
          WHERE tenantId=? AND (? IS NULL OR (employeeId=? AND ((status='pending' AND reviewDeadline>?) OR (status='approved' AND expiresAt>?))))
          ORDER BY CASE WHEN (status='pending' AND reviewDeadline>?) OR (status='approved' AND expiresAt>?) THEN 0 ELSE 1 END,
          createdAt DESC,rowid DESC LIMIT 100`)
              .all(
                collection.principal.tenantId,
                activeEmployeeId ?? null,
                activeEmployeeId ?? null,
                now,
                now,
                now,
                now,
              )
          : this.db.sql
              .prepare<[string], { id: string }>(
                "SELECT id FROM employees WHERE tenantId=? ORDER BY name LIMIT 100",
              )
              .all(collection.principal.tenantId);
      await this.authorize({
        capability,
        intent: "read",
        resourceId: "collection",
        facts: collection,
        parameters: {},
        requestId: this.requestId,
        now,
      });
      const candidates = ids.map(({ id }) => ({
        id,
        facts: this.snapshot(actor, capability, "read", id),
      }));
      const allowed: typeof candidates = [];
      for (const candidate of candidates) {
        try {
          await this.authorize({
            capability,
            intent: "read",
            resourceId: candidate.id,
            facts: candidate.facts,
            parameters: {},
            requestId: this.requestId,
            now: Date.now(),
          });
          allowed.push(candidate);
        } catch (error) {
          if (!(error instanceof AppError && error.status === 403)) throw error;
        }
      }
      try {
        return this.db.sql
          .transaction(() => {
            if (
              JSON.stringify(
                this.snapshot(actor, capability, "read", ":collection"),
              ) !== JSON.stringify(collection)
            )
              throw new ChangedFacts();
            for (const candidate of candidates)
              if (
                JSON.stringify(
                  this.snapshot(actor, capability, "read", candidate.id),
                ) !== JSON.stringify(candidate.facts)
              )
                throw new ChangedFacts();
            return allowed.map(({ facts }) => project(facts));
          })
          .immediate();
      } catch (error) {
        if (!(error instanceof ChangedFacts)) throw error;
      }
    }
    throw conflict();
  }
  grants(
    actor: string,
    view: "requests" | "review",
    activeEmployeeId?: string,
  ): Promise<Grant[]> {
    return this.list(
      actor,
      view === "requests" ? "grant.request" : "grant.approve",
      "grants",
      ({ grant }) => {
        if (!grant) throw missing();
        const row = this.db.grant(grant.id);
        if (!row) throw missing();
        return this.db.grantView(row);
      },
      activeEmployeeId,
    );
  }
  grant(
    actor: string,
    id: string,
    view: "requests" | "review",
  ): Promise<Grant> {
    return this.effect(
      actor,
      view === "requests" ? "grant.request" : "grant.approve",
      "read",
      id,
      () => {
        const row = this.db.grant(id);
        if (!row) throw missing();
        return this.db.grantView(row);
      },
    );
  }
  options(actor: string): Promise<AccessOptions> {
    return this.effect(
      actor,
      "grant.request",
      "read",
      ":collection",
      ({ principal }) => {
        const beneficiaries = this.db.sql
          .prepare<[string], { id: string; name: string; role: string }>(
            "SELECT id,name,role FROM principals WHERE tenantId=? ORDER BY name",
          )
          .all(principal.tenantId)
          .filter(({ id }) => accounts.some((account) => account.id === id));
        return { packages: accessPackages, beneficiaries };
      },
    );
  }
  employees(actor: string): Promise<Profile[]> {
    return this.list(
      actor,
      "employee.profile.view",
      "employees",
      profileProjection,
    );
  }
  profile(actor: string, id: string): Promise<Profile> {
    return this.effect(
      actor,
      "employee.profile.view",
      "read",
      id,
      profileProjection,
    );
  }
  contact(actor: string, id: string): Promise<Contact> {
    return this.effect(actor, "employee.contact.view", "read", id, () =>
      contactProjection(this.db, id),
    );
  }
  medical(actor: string, id: string): Promise<Medical> {
    return this.effect(actor, "employee.medical.view", "read", id, () =>
      medicalProjection(this.db, id),
    );
  }
}
