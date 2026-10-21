import Sqlite from "better-sqlite3";
import {
  accessPackages,
  type Grant,
  type GrantStatus,
} from "../../shared/contracts.ts";
import { assertSqlitePath } from "./files.ts";
import { seed } from "./fixtures.ts";
import type {
  Employee,
  GrantRow,
  MedicalRow,
  Principal,
  Session,
} from "./models.ts";
import { SCHEMA_VERSION, schema } from "./schema.ts";

export type {
  Employee,
  GrantRow,
  LoginTransaction,
  Principal,
  Session,
} from "./models.ts";

export class Database {
  readonly sql: Sqlite.Database;
  constructor(path: string) {
    if (path !== ":memory:") assertSqlitePath(path);
    this.sql = new Sqlite(path);
    try {
      this.sql.pragma("foreign_keys = ON");
      this.sql.pragma("journal_mode = WAL");
      this.sql.pragma("busy_timeout = 3000");
      const version = this.sql.pragma("user_version", { simple: true });
      const populated = this.sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        )
        .get();
      if (version !== SCHEMA_VERSION && populated)
        throw new Error(
          "P12 data uses a different baseline schema. Stop P12 and explicitly run pnpm reset, or choose a fresh data directory. Existing data was not replaced.",
        );
      if (!populated)
        this.sql.transaction(() => {
          this.sql.exec(schema);
          seed(this.sql);
          this.sql.pragma(`user_version = ${SCHEMA_VERSION}`);
        })();
    } catch (error) {
      this.sql.close();
      throw error;
    }
  }
  principal(id: string): Principal | undefined {
    return this.sql
      .prepare<[string], Principal>("SELECT * FROM principals WHERE id = ?")
      .get(id);
  }
  employee(id: string): Employee | undefined {
    return this.sql
      .prepare<[string], Employee>("SELECT * FROM employees WHERE id = ?")
      .get(id);
  }
  medicalVersion(id: string): number | null {
    return (
      this.sql
        .prepare<[string], { version: number }>(
          "SELECT version FROM medical_records WHERE employeeId = ?",
        )
        .get(id)?.version ?? null
    );
  }
  medical(id: string): MedicalRow | undefined {
    return this.sql
      .prepare<[string], MedicalRow>(
        "SELECT * FROM medical_records WHERE employeeId = ?",
      )
      .get(id);
  }
  grant(id: string): GrantRow | undefined {
    return this.sql
      .prepare<[string], GrantRow>("SELECT * FROM grants WHERE id = ?")
      .get(id);
  }
  currentGrant(
    beneficiaryId: string,
    employeeId: string,
    packageId = "team-support",
  ): GrantRow | undefined {
    return this.sql
      .prepare<[string, string, string], GrantRow>(
        "SELECT * FROM grants WHERE beneficiaryId = ? AND employeeId = ? AND packageId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1",
      )
      .get(beneficiaryId, employeeId, packageId);
  }
  grantView(grant: GrantRow, now = Date.now()): Grant {
    const {
      id,
      packageId,
      employeeId,
      requesterId,
      beneficiaryId,
      scope,
      reason,
      durationDays,
      status,
      createdAt,
      reviewDeadline,
      approvedAt,
      expiresAt,
      reviewedBy,
      reviewedAt,
      reviewNote,
      revokedBy,
      revokedAt,
      version,
    } = grant;
    const fields = {
      id,
      packageId,
      employeeId,
      requesterId,
      beneficiaryId,
      scope,
      reason,
      durationDays,
      status,
      createdAt,
      reviewDeadline,
      approvedAt,
      expiresAt,
      reviewedBy,
      reviewedAt,
      reviewNote,
      revokedBy,
      revokedAt,
      version,
    };
    return {
      ...fields,
      packageName:
        accessPackages.find((pkg) => pkg.id === grant.packageId)?.name ??
        "Unavailable",
      employeeName: this.employee(grant.employeeId)?.name ?? "Unavailable",
      requesterName: this.principal(grant.requesterId)?.name ?? "Unavailable",
      beneficiaryName:
        this.principal(grant.beneficiaryId)?.name ?? "Unavailable",
      reviewerName: grant.reviewedBy
        ? (this.principal(grant.reviewedBy)?.name ?? "Unavailable")
        : null,
      revokerName: grant.revokedBy
        ? (this.principal(grant.revokedBy)?.name ?? "Unavailable")
        : null,
      status: effectiveStatus(grant, now),
    };
  }
  session(id: string): Session | undefined {
    this.prune();
    return this.sql
      .prepare<[string], Session>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
  }
  prune() {
    this.sql
      .prepare("DELETE FROM sessions WHERE expiresAt <= ?")
      .run(Date.now());
    this.sql
      .prepare("DELETE FROM login_transactions WHERE expiresAt <= ?")
      .run(Date.now());
  }
  close() {
    this.sql.close();
  }
}
export function effectiveStatus(grant: GrantRow, now: number): GrantStatus {
  const deadline =
    grant.status === "pending"
      ? grant.reviewDeadline
      : grant.status === "approved"
        ? grant.expiresAt
        : null;
  return deadline !== null && deadline <= now ? "expired" : grant.status;
}
