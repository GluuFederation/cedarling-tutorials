import { randomUUID } from "node:crypto";
import Sqlite from "better-sqlite3";
import { tutorialUsers } from "../shared/catalog.ts";
import type {
  Checklist,
  Inspection,
  Role,
  User,
  WorkOrder,
} from "../shared/types.ts";
import { contentHash, randomToken, tokenHash } from "./crypto.ts";

export type LoginTransaction = Readonly<{
  id: string;
  state: string;
  nonce: string;
  verifier: string;
}>;

export type AppSession = Readonly<{
  user: User;
  csrfToken: string;
  expiresAt: number;
}>;

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type WorkOrderRow = {
  id: string;
  equipment: string;
  site: string;
  status: string;
  work_order_version: number;
  technician_id: string;
  technician_name: string;
  assignment_epoch: number;
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('technician', 'supervisor')),
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  equipment TEXT NOT NULL,
  site TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
  work_order_version INTEGER NOT NULL CHECK (work_order_version > 0)
);
CREATE TABLE IF NOT EXISTS assignments (
  work_order_id TEXT PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  technician_id TEXT NOT NULL REFERENCES users(id),
  assignment_epoch INTEGER NOT NULL CHECK (assignment_epoch > 0)
);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  checklist_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_results (
  idempotency_key TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES users(id),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export class AppDatabase {
  private readonly raw: Sqlite.Database;

  constructor(path: string, issuer: string) {
    this.raw = new Sqlite(path);
    this.raw.pragma("journal_mode = WAL");
    this.raw.exec(schema);
    this.seed(issuer);
  }

  close(): void {
    this.raw.close();
  }

  reset(issuer: string): void {
    this.raw.transaction(() => {
      this.raw.exec(`
        DELETE FROM sessions;
        DELETE FROM oidc_transactions;
        DELETE FROM idempotency_results;
        DELETE FROM inspections;
        DELETE FROM assignments;
        DELETE FROM work_orders;
        DELETE FROM users;
      `);
      this.seedRows(issuer);
    })();
  }

  private seed(issuer: string): void {
    const row = this.raw
      .prepare("SELECT COUNT(*) AS count FROM users")
      .get() as {
      count: number;
    };
    if (row.count === 0) this.seedRows(issuer);
  }

  private seedRows(issuer: string): void {
    const insertUser = this.raw.prepare(
      "INSERT INTO users (id, issuer, subject, name, role) VALUES (?, ?, ?, ?, ?)",
    );
    for (const user of tutorialUsers) {
      insertUser.run(user.id, issuer, user.subject, user.name, user.role);
    }
    const insertWorkOrder = this.raw.prepare(
      "INSERT INTO work_orders (id, equipment, site, status, work_order_version) VALUES (?, ?, ?, 'open', 1)",
    );
    const workOrders = [
      ["wo-pump-17", "Cooling pump 17", "North Plant", "user-elena"],
      ["wo-generator-04", "Backup generator 04", "East Depot", "user-malik"],
      ["wo-compressor-09", "Air compressor 09", "South Workshop", "user-elena"],
      [
        "wo-fire-panel-12",
        "Fire suppression panel 12",
        "West Warehouse",
        "user-malik",
      ],
      ["wo-conveyor-08", "Conveyor motor 08", "Packaging Hall", "user-elena"],
      [
        "wo-ventilation-03",
        "Ventilation unit 03",
        "Service Annex",
        "user-malik",
      ],
    ] as const;
    const assign = this.raw.prepare(
      "INSERT INTO assignments (work_order_id, technician_id, assignment_epoch) VALUES (?, ?, 1)",
    );
    for (const [id, equipment, site, technicianId] of workOrders) {
      insertWorkOrder.run(id, equipment, site);
      assign.run(id, technicianId);
    }
  }

  findUser(issuer: string, subject: string): User | undefined {
    return this.mapUser(
      this.raw
        .prepare(
          "SELECT id, name, role FROM users WHERE issuer = ? AND subject = ?",
        )
        .get(issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return this.mapUser(
      this.raw.prepare("SELECT id, name, role FROM users WHERE id = ?").get(id),
    );
  }

  private mapUser(value: unknown): User | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      role: String(row.role) as Role,
    };
  }

  createLoginTransaction(now = Date.now()): LoginTransaction {
    this.raw
      .prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
      .run(now);
    const transaction = {
      id: randomToken(),
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
    };
    this.raw
      .prepare(
        "INSERT INTO oidc_transactions (id_hash, state, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        tokenHash(transaction.id),
        transaction.state,
        transaction.nonce,
        transaction.verifier,
        now + 2 * 60_000,
      );
    return transaction;
  }

  consumeLoginTransaction(
    id: string,
    now = Date.now(),
  ): Omit<LoginTransaction, "id"> | undefined {
    return this.raw.transaction(() => {
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM oidc_transactions WHERE id_hash = ?",
        )
        .get(tokenHash(id)) as
        | { state: string; nonce: string; verifier: string; expires_at: number }
        | undefined;
      this.raw
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(tokenHash(id));
      if (!row || row.expires_at <= now) return undefined;
      return { state: row.state, nonce: row.nonce, verifier: row.verifier };
    })();
  }

  createSession(
    userId: string,
    identityExpiresAt: number,
  ): { id: string; session: AppSession } {
    const id = randomToken();
    const csrfToken = randomToken();
    const expiresAt = Math.min(identityExpiresAt, Date.now() + 30 * 60_000);
    this.raw
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    this.raw
      .prepare(
        "INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(tokenHash(id), userId, csrfToken, expiresAt);
    const user = this.findUserById(userId);
    if (!user) throw new Error("Session user disappeared");
    return { id, session: { user, csrfToken, expiresAt } };
  }

  findSession(id: string, now = Date.now()): AppSession | undefined {
    const row = this.raw
      .prepare(
        `SELECT s.csrf_token, s.expires_at, u.id, u.name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ?`,
      )
      .get(tokenHash(id)) as
      | {
          csrf_token: string;
          expires_at: number;
          id: string;
          name: string;
          role: Role;
        }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at <= now) {
      this.destroySession(id);
      return undefined;
    }
    return {
      user: { id: row.id, name: row.name, role: row.role },
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
  }

  csrfMatches(session: AppSession, token: string): boolean {
    return tokenHash(session.csrfToken) === tokenHash(token);
  }

  destroySession(id: string): void {
    this.raw
      .prepare("DELETE FROM sessions WHERE id_hash = ?")
      .run(tokenHash(id));
  }

  listWorkOrders(limit = 20): readonly WorkOrder[] {
    const rows = this.raw
      .prepare(
        `SELECT w.id, w.equipment, w.site, w.status, w.work_order_version,
                a.technician_id, a.assignment_epoch, u.name AS technician_name
         FROM work_orders w
         JOIN assignments a ON a.work_order_id = w.id
         JOIN users u ON u.id = a.technician_id
         ORDER BY w.id LIMIT ?`,
      )
      .all(Math.min(limit, 20)) as WorkOrderRow[];
    return rows.map(mapWorkOrder);
  }

  findWorkOrder(id: string): WorkOrder | undefined {
    const row = this.raw
      .prepare(
        `SELECT w.id, w.equipment, w.site, w.status, w.work_order_version,
                a.technician_id, a.assignment_epoch, u.name AS technician_name
         FROM work_orders w
         JOIN assignments a ON a.work_order_id = w.id
         JOIN users u ON u.id = a.technician_id
         WHERE w.id = ?`,
      )
      .get(id) as WorkOrderRow | undefined;
    return row ? mapWorkOrder(row) : undefined;
  }

  createWorkOrder(values: {
    equipment: string;
    site: string;
    technicianId: string;
  }): WorkOrder {
    return this.raw.transaction(() => {
      const technician = this.findUserById(values.technicianId);
      if (technician?.role !== "technician") {
        throw new DomainError("invalid_technician", 400);
      }
      const id = `wo-${randomUUID()}`;
      this.raw
        .prepare(
          "INSERT INTO work_orders (id, equipment, site, status, work_order_version) VALUES (?, ?, ?, 'open', 1)",
        )
        .run(id, values.equipment, values.site);
      this.raw
        .prepare(
          "INSERT INTO assignments (work_order_id, technician_id, assignment_epoch) VALUES (?, ?, 1)",
        )
        .run(id, values.technicianId);
      return this.findWorkOrder(id) as WorkOrder;
    })();
  }

  deleteWorkOrder(values: {
    workOrderId: string;
    expectedWorkOrderVersion: number;
    expectedAssignmentEpoch: number;
  }): void {
    const result = this.raw
      .prepare(
        `DELETE FROM work_orders
         WHERE id = ? AND status = 'open' AND work_order_version = ?
           AND NOT EXISTS (
             SELECT 1 FROM inspections WHERE work_order_id = work_orders.id
           )
           AND EXISTS (
             SELECT 1 FROM assignments
             WHERE work_order_id = work_orders.id AND assignment_epoch = ?
           )`,
      )
      .run(
        values.workOrderId,
        values.expectedWorkOrderVersion,
        values.expectedAssignmentEpoch,
      );
    if (result.changes !== 1) throw new DomainError("state_conflict", 409);
  }

  reassign(values: {
    workOrderId: string;
    technicianId: string;
    expectedAssignmentEpoch: number;
  }): WorkOrder {
    return this.raw.transaction(() => {
      const technician = this.findUserById(values.technicianId);
      if (technician?.role !== "technician") {
        throw new DomainError("invalid_technician", 400);
      }
      const result = this.raw
        .prepare(
          `UPDATE assignments SET technician_id = ?, assignment_epoch = assignment_epoch + 1
           WHERE work_order_id = ? AND assignment_epoch = ?
             AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND status = 'open')`,
        )
        .run(
          values.technicianId,
          values.workOrderId,
          values.expectedAssignmentEpoch,
          values.workOrderId,
        );
      if (result.changes !== 1) throw new DomainError("state_conflict", 409);
      return this.findWorkOrder(values.workOrderId) as WorkOrder;
    })();
  }

  submit(values: {
    principalId: string;
    workOrderId: string;
    capturedAssignmentEpoch: number;
    idempotencyKey: string;
    expectedWorkOrderVersion: number;
    checklist: Checklist;
    notes: string;
  }): { inspection: Inspection; workOrder: WorkOrder; replayed: boolean } {
    const normalized = {
      workOrderId: values.workOrderId,
      expectedWorkOrderVersion: values.expectedWorkOrderVersion,
      checklist: values.checklist,
      notes: values.notes,
    };
    const requestHash = contentHash(normalized);
    return this.raw.transaction(() => {
      const prior = this.raw
        .prepare(
          "SELECT principal_id, request_hash, result_json FROM idempotency_results WHERE idempotency_key = ?",
        )
        .get(values.idempotencyKey) as
        | { principal_id: string; request_hash: string; result_json: string }
        | undefined;
      if (prior) {
        if (
          prior.principal_id !== values.principalId ||
          prior.request_hash !== requestHash
        ) {
          throw new DomainError("idempotency_conflict", 409);
        }
        return { ...JSON.parse(prior.result_json), replayed: true } as {
          inspection: Inspection;
          workOrder: WorkOrder;
          replayed: boolean;
        };
      }
      const current = this.findWorkOrder(values.workOrderId);
      if (
        current?.status !== "open" ||
        current.workOrderVersion !== values.expectedWorkOrderVersion ||
        current.assignmentEpoch !== values.capturedAssignmentEpoch
      ) {
        throw new DomainError("state_conflict", 409);
      }
      const update = this.raw
        .prepare(
          `UPDATE work_orders SET status = 'completed', work_order_version = work_order_version + 1
           WHERE id = ? AND status = 'open' AND work_order_version = ?
             AND EXISTS (
               SELECT 1 FROM assignments
               WHERE work_order_id = ? AND assignment_epoch = ?
             )`,
        )
        .run(
          values.workOrderId,
          values.expectedWorkOrderVersion,
          values.workOrderId,
          values.capturedAssignmentEpoch,
        );
      if (update.changes !== 1) throw new DomainError("state_conflict", 409);
      const inspection: Inspection = {
        id: `inspection_${randomToken(12)}`,
        workOrderId: values.workOrderId,
        submittedBy: values.principalId,
        checklist: values.checklist,
        notes: values.notes,
        createdAt: new Date().toISOString(),
      };
      this.raw
        .prepare(
          `INSERT INTO inspections
           (id, work_order_id, submitted_by, checklist_json, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          inspection.id,
          inspection.workOrderId,
          inspection.submittedBy,
          JSON.stringify(inspection.checklist),
          inspection.notes,
          inspection.createdAt,
        );
      const workOrder = this.findWorkOrder(values.workOrderId) as WorkOrder;
      const stored = { inspection, workOrder };
      this.raw
        .prepare(
          `INSERT INTO idempotency_results
           (idempotency_key, principal_id, request_hash, result_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          values.idempotencyKey,
          values.principalId,
          requestHash,
          JSON.stringify(stored),
        );
      return { ...stored, replayed: false };
    })();
  }

  inspectionCount(): number {
    return (
      this.raw.prepare("SELECT COUNT(*) AS count FROM inspections").get() as {
        count: number;
      }
    ).count;
  }
}

function mapWorkOrder(row: WorkOrderRow): WorkOrder {
  return {
    id: row.id,
    equipment: row.equipment,
    site: row.site,
    status: row.status as WorkOrder["status"],
    workOrderVersion: row.work_order_version,
    assigneeId: row.technician_id,
    assigneeName: row.technician_name,
    assignmentEpoch: row.assignment_epoch,
  };
}
