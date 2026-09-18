import { randomUUID } from "node:crypto";
import type {
  Capability,
  Contact,
  Grant,
  Profile,
} from "../shared/contracts.ts";
import type { Authorize, Facts } from "./authorization.ts";
import { type Database, effectiveStatus } from "./database.ts";
import {
  AppError,
  activeGrantExists,
  conflict,
  integer,
  missing,
  unauthorized,
} from "./errors.ts";

class ChangedFacts extends Error {}
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
  ): Facts {
    const principal = this.db.principal(actorId);
    if (!principal) throw unauthorized();
    const pkg = this.db.sql
      .prepare<[], Facts["package"]>(
        "SELECT * FROM packages WHERE id = 'team-support'",
      )
      .get();
    if (!pkg) throw missing();
    const base: Facts = { principal, package: pkg };
    if (target === ":collection" && intent === "read") return base;
    if (capability === "grant.request" && intent === "execute") {
      const employee = this.db.employee(target);
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
      const grant = this.db.currentGrant(manager.id, employee.id);
      return {
        ...base,
        employee,
        manager,
        ...(grant
          ? {
              effectiveGrant: {
                ...grant,
                status: effectiveStatus(grant, Date.now()),
              },
            }
          : {}),
      };
    }
    if (capability.startsWith("grant.")) {
      const grant = this.db.grant(target);
      if (!grant || grant.tenantId !== principal.tenantId) throw missing();
      const employee = this.db.employee(grant.employeeId);
      const manager = this.db.principal(grant.managerId);
      if (!employee || !manager) throw missing();
      return {
        ...base,
        employee,
        manager,
        grant: { ...grant, status: effectiveStatus(grant, Date.now()) },
      };
    }
    const employee = this.db.employee(target);
    if (!employee || employee.tenantId !== principal.tenantId) throw missing();
    const manager = this.db.principal(employee.managerId);
    if (!manager) throw missing();
    const grant = this.db.currentGrant(actorId, employee.id);
    return {
      ...base,
      employee,
      manager,
      ...(grant
        ? {
            effectiveGrant: {
              ...grant,
              status: effectiveStatus(grant, Date.now()),
            },
          }
        : {}),
    };
  }
  private async effect<T>(
    actor: string,
    capability: Capability,
    intent: "read" | "execute",
    target: string,
    effect: (facts: Facts) => T,
    parameters: Readonly<{
      durationDays?: number;
      expectedVersion?: number;
    }> = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const facts = this.snapshot(actor, capability, intent, target);
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
            const current = this.snapshot(actor, capability, intent, target);
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
  async request(actor: string, employee: string, days: number): Promise<Grant> {
    integer(days, 7);
    return this.effect(
      actor,
      "grant.request",
      "execute",
      employee,
      (facts) => {
        if (!facts.employee || !facts.manager) throw missing();
        const now = Date.now();
        this.db.sql
          .prepare(
            `UPDATE grants
             SET status = 'expired', version = version + 1
             WHERE packageId = ?
               AND managerId = ?
               AND employeeId = ?
               AND status IN ('pending','approved')
               AND expiresAt <= ?`,
          )
          .run(facts.package.id, facts.manager.id, employee, now);
        if (
          this.db.sql
            .prepare(
              `SELECT id FROM grants
               WHERE packageId = ?
                 AND managerId = ?
                 AND employeeId = ?
                 AND status IN ('pending','approved')`,
            )
            .get(facts.package.id, facts.manager.id, employee)
        )
          throw activeGrantExists(facts.manager.name, facts.employee.name);
        const grant = {
          id: `grant_${randomUUID()}`,
          tenantId: facts.principal.tenantId,
          packageId: facts.package.id,
          employeeId: employee,
          requesterId: actor,
          managerId: facts.manager.id,
          scope: facts.package.scope,
          status: "pending" as const,
          expiresAt: now + days * 86400000,
          version: 1,
        };
        this.db.sql
          .prepare(
            `INSERT INTO grants VALUES (
               @id, @tenantId, @packageId, @employeeId, @requesterId, @managerId,
               @scope, @status, @expiresAt, @version
             )`,
          )
          .run(grant);
        return this.db.grantView(grant);
      },
      { durationDays: days },
    );
  }
  async transition(
    actor: string,
    id: string,
    version: number,
    operation: "approve" | "revoke",
  ): Promise<Grant> {
    integer(version);
    return this.effect(
      actor,
      operation === "approve" ? "grant.approve" : "grant.revoke",
      "execute",
      id,
      ({ grant }) => {
        if (
          !grant ||
          grant.version !== version ||
          grant.status !== (operation === "approve" ? "pending" : "approved")
        )
          throw conflict();
        const status = operation === "approve" ? "approved" : "revoked";
        const changed = this.db.sql
          .prepare(
            `UPDATE grants
             SET status = ?, version = version + 1
             WHERE id = ?
               AND version = ?
               AND status = ?
               AND expiresAt > ?`,
          )
          .run(status, id, version, grant.status, Date.now());
        if (changed.changes !== 1) throw conflict();
        return this.db.grantView({ ...grant, status, version: version + 1 });
      },
      { expectedVersion: version },
    );
  }
  private async list<T>(
    actor: string,
    capability: Capability,
    table: "grants" | "employees",
    project: (facts: Facts) => T,
  ): Promise<T[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const collection = this.snapshot(
        actor,
        capability,
        "read",
        ":collection",
      );
      const ids = this.db.sql
        .prepare<[string], { id: string }>(
          `SELECT id FROM ${table}
           WHERE tenantId = ?
           ORDER BY id
           LIMIT 100`,
        )
        .all(collection.principal.tenantId);
      await this.authorize({
        capability,
        intent: "read",
        resourceId: "collection",
        facts: collection,
        parameters: {},
        requestId: this.requestId,
        now: Date.now(),
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
  grants(actor: string, view: "requests" | "review"): Promise<Grant[]> {
    return this.list(
      actor,
      view === "requests" ? "grant.request" : "grant.approve",
      "grants",
      ({ grant }) => {
        if (!grant) throw missing();
        return this.db.grantView(grant);
      },
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
      ({ grant }) => {
        if (!grant) throw missing();
        return this.db.grantView(grant);
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
    return this.effect(
      actor,
      "employee.contact.view",
      "read",
      id,
      ({ employee }) => {
        if (!employee) throw missing();
        const { id, workEmail, workPhone, version } = employee;
        return { id, workEmail, workPhone, version };
      },
    );
  }
}

function profileProjection({ employee, manager }: Facts): Profile {
  if (!employee || !manager) throw missing();
  const { id, name, managerId, team, jobTitle, version } = employee;
  return {
    id,
    name,
    managerId,
    managerName: manager.name,
    team,
    jobTitle,
    version,
  };
}
