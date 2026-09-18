import Sqlite from "better-sqlite3";
import type { Grant, GrantStatus } from "../shared/contracts.ts";
import { accounts } from "../shared/contracts.ts";
import { assertSqlitePath } from "./files.ts";
export type Principal = Readonly<{
  id: string;
  name: string;
  tenantId: string;
  role: string;
  administrator: number;
  reviewer: number;
  version: number;
}>;
export type Employee = Readonly<{
  id: string;
  name: string;
  tenantId: string;
  managerId: string;
  team: string;
  jobTitle: string;
  workEmail: string;
  workPhone: string;
  version: number;
}>;
export type GrantRow = Readonly<{
  id: string;
  tenantId: string;
  packageId: string;
  employeeId: string;
  requesterId: string;
  managerId: string;
  scope: string;
  status: GrantStatus;
  expiresAt: number;
  version: number;
}>;
export type Session = Readonly<{
  id: string;
  principalId: string;
  csrfToken: string;
  expiresAt: number;
}>;
export type LoginTransaction = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
}>;
export class Database {
  readonly sql: Sqlite.Database;
  constructor(path: string) {
    if (path !== ":memory:") assertSqlitePath(path);
    this.sql = new Sqlite(path);
    this.sql.pragma("foreign_keys = ON");
    this.sql.pragma("journal_mode = WAL");
    this.sql.pragma("busy_timeout = 3000");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS principals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tenantId TEXT NOT NULL,
        role TEXT NOT NULL,
        administrator INTEGER NOT NULL,
        reviewer INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tenantId TEXT NOT NULL,
        managerId TEXT NOT NULL REFERENCES principals(id),
        team TEXT NOT NULL,
        jobTitle TEXT NOT NULL,
        workEmail TEXT NOT NULL,
        workPhone TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        fieldGroups TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        principalId TEXT NOT NULL REFERENCES principals(id),
        csrfToken TEXT NOT NULL,
        expiresAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_transactions (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expiresAt INTEGER NOT NULL
      );
    `);
    this.sql.transaction(() => {
      const duties = {
        lin: { administrator: 1, reviewer: 1 },
        nia: { administrator: 0, reviewer: 1 },
        ben: { administrator: 0, reviewer: 0 },
      } as const;
      const insertPrincipal = this.sql.prepare(`
        INSERT OR IGNORE INTO principals
        VALUES (@id, @name, 'tenant-a', @role, @administrator, @reviewer, 1)
      `);
      for (const account of accounts)
        insertPrincipal.run({ ...account, ...duties[account.id] });
      this.sql.exec(`
        INSERT OR IGNORE INTO principals VALUES
          ('other-manager', 'Other manager', 'tenant-a', 'Manager', 0, 0, 1),
          ('foreign-manager', 'Foreign manager', 'tenant-b', 'Manager', 0, 0, 1);
        INSERT OR IGNORE INTO employees VALUES
          ('cora', 'Cora', 'tenant-a', 'ben', 'Support', 'Support specialist',
           'cora@example.test', '+1 202 555 0101', 1),
          ('other-team', 'Dee', 'tenant-a', 'other-manager',
           'Operations', 'Operations specialist',
           'dee@example.test', '+1 202 555 0102', 1),
          ('foreign', 'Eli', 'tenant-b', 'foreign-manager',
           'Support', 'Support specialist',
           'eli@example.test', '+1 202 555 0103', 1);
        INSERT OR IGNORE INTO packages
          VALUES ('team-support', 'current-direct-reports', 'basic,contact');
      `);
      this.migrateGrants();
    })();
  }
  private migrateGrants() {
    const columns = this.sql
      .prepare<[], { name: string }>("PRAGMA table_info(grants)")
      .all();
    if (columns.length && !columns.some(({ name }) => name === "employeeId")) {
      this.sql.exec(`
        DROP INDEX IF EXISTS active_grant;
        ALTER TABLE grants RENAME TO grants_legacy;
      `);
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY,
        tenantId TEXT NOT NULL,
        packageId TEXT NOT NULL REFERENCES packages(id),
        employeeId TEXT NOT NULL REFERENCES employees(id),
        requesterId TEXT NOT NULL REFERENCES principals(id),
        managerId TEXT NOT NULL REFERENCES principals(id),
        scope TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN ('pending','approved','revoked','expired')),
        expiresAt INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS active_grant
        ON grants(packageId, employeeId, managerId)
        WHERE status IN ('pending','approved');
    `);
    const legacy = this.sql
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'grants_legacy'",
      )
      .get();
    if (legacy) {
      this.sql.exec(`
        INSERT INTO grants (
          id, tenantId, packageId, employeeId, requesterId, managerId,
          scope, status, expiresAt, version
        )
        SELECT id, tenantId, packageId, 'cora', requesterId, managerId,
               scope, status, expiresAt, version
        FROM grants_legacy;
        DROP TABLE grants_legacy;
      `);
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
  grant(id: string): GrantRow | undefined {
    return this.sql
      .prepare<[string], GrantRow>("SELECT * FROM grants WHERE id = ?")
      .get(id);
  }
  currentGrant(managerId: string, employeeId: string): GrantRow | undefined {
    return this.sql
      .prepare<[string, string], GrantRow>(
        `SELECT * FROM grants
         WHERE managerId = ? AND employeeId = ?
         ORDER BY rowid DESC
         LIMIT 1`,
      )
      .get(managerId, employeeId);
  }
  grantView(grant: GrantRow, now = Date.now()): Grant {
    return {
      id: grant.id,
      packageId: grant.packageId,
      employeeId: grant.employeeId,
      employeeName: this.employee(grant.employeeId)?.name ?? "Unavailable",
      requesterId: grant.requesterId,
      requesterName: this.principal(grant.requesterId)?.name ?? "Unavailable",
      managerId: grant.managerId,
      managerName: this.principal(grant.managerId)?.name ?? "Unavailable",
      scope: grant.scope,
      status: effectiveStatus(grant, now),
      expiresAt: grant.expiresAt,
      version: grant.version,
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
  return (grant.status === "pending" || grant.status === "approved") &&
    grant.expiresAt <= now
    ? "expired"
    : grant.status;
}
