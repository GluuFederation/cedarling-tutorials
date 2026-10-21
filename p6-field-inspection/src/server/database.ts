import { randomUUID } from "node:crypto";
import Sqlite from "better-sqlite3";
import { checklistKeys, tutorialUsers } from "../shared/catalog.ts";
import { validNotes } from "../shared/notes.ts";
import type {
  AssignmentChange,
  Checklist,
  Inspection,
  InspectionReview,
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
  status TEXT NOT NULL CHECK (status IN ('open', 'awaiting_review', 'changes_requested', 'completed')),
  work_order_version INTEGER NOT NULL CHECK (work_order_version > 0)
);
CREATE TABLE IF NOT EXISTS assignments (
  work_order_id TEXT PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  technician_id TEXT NOT NULL REFERENCES users(id),
  assignment_epoch INTEGER NOT NULL CHECK (assignment_epoch > 0)
);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  checklist_json TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignment_changes (
  id INTEGER PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  previous_assignee TEXT NOT NULL REFERENCES users(id),
  new_assignee TEXT NOT NULL REFERENCES users(id),
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL,
  assignment_epoch INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_results (
  idempotency_key TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES users(id),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inspection_reviews (
  inspection_id TEXT PRIMARY KEY REFERENCES inspections(id),
  reviewed_by TEXT NOT NULL REFERENCES users(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'request_corrections')),
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL
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

  constructor(path: string, issuer: string, options: { reset?: boolean } = {}) {
    this.raw = new Sqlite(path);
    try {
      if (!options.reset) this.requireCurrentChecklist();
      this.raw.pragma("journal_mode = WAL");
      this.raw.exec(schema);
      this.migrateInspectionWorkflow();
      if (options.reset) this.reset(issuer);
      else this.seed(issuer);
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }

  private requireCurrentChecklist(): void {
    const table = this.raw
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'inspections'")
      .get();
    if (!table) return;
    const records = this.raw
      .prepare("SELECT checklist_json FROM inspections")
      .iterate() as Iterable<{ checklist_json: string }>;
    for (const row of records) {
      const value = JSON.parse(row.checklist_json) as Record<string, unknown>;
      if (
        Object.keys(value).length !== checklistKeys.length ||
        checklistKeys.some((key) => typeof value[key] !== "boolean")
      ) {
        throw new Error(
          "P6 saved inspections use a different checklist. Stop P6 and run pnpm reset to replace its practice data. See README.md for Docker reset instructions.",
        );
      }
    }
  }

  private migrateInspectionWorkflow(): void {
    const table = this.raw
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'work_orders'")
      .get() as { sql: string };
    if (table.sql.includes("'awaiting_review'")) return;
    // Rebuild the two legacy tables together. All IDs, completed records, and
    // idempotency results survive; no supervisor review is invented.
    this.raw.pragma("foreign_keys = OFF");
    try {
      this.raw.transaction(() => {
        this.raw.exec(`
          CREATE TABLE work_orders_v2 (
            id TEXT PRIMARY KEY, equipment TEXT NOT NULL, site TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('open', 'awaiting_review', 'changes_requested', 'completed')),
            work_order_version INTEGER NOT NULL CHECK (work_order_version > 0)
          );
          INSERT INTO work_orders_v2 SELECT * FROM work_orders;
          CREATE TABLE inspections_v2 (
            id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders(id),
            submitted_by TEXT NOT NULL REFERENCES users(id), checklist_json TEXT NOT NULL,
            notes TEXT NOT NULL, created_at TEXT NOT NULL
          );
          INSERT INTO inspections_v2 SELECT * FROM inspections;
          DROP TABLE inspections;
          DROP TABLE work_orders;
          ALTER TABLE work_orders_v2 RENAME TO work_orders;
          ALTER TABLE inspections_v2 RENAME TO inspections;
        `);
        if ((this.raw.pragma("foreign_key_check") as unknown[]).length)
          throw new Error("Inspection migration failed integrity checks");
      })();
    } finally {
      this.raw.pragma("foreign_keys = ON");
    }
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
        DELETE FROM inspection_reviews;
        DELETE FROM inspections;
        DELETE FROM assignment_changes;
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

  listWorkOrders(limit = 20, offset = 0): readonly WorkOrder[] {
    const rows = this.raw
      .prepare(
        `SELECT w.id, w.equipment, w.site, w.status, w.work_order_version,
                a.technician_id, a.assignment_epoch, u.name AS technician_name
         FROM work_orders w
         JOIN assignments a ON a.work_order_id = w.id
         JOIN users u ON u.id = a.technician_id
         ORDER BY w.id LIMIT ? OFFSET ?`,
      )
      .all(Math.min(limit, 20), offset) as WorkOrderRow[];
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
    principalId: string;
    workOrderId: string;
    technicianId: string;
    expectedAssignmentEpoch: number;
  }): WorkOrder {
    return this.raw.transaction(() => {
      const technician = this.findUserById(values.technicianId);
      if (technician?.role !== "technician") {
        throw new DomainError("invalid_technician", 400);
      }
      const before = this.findWorkOrder(values.workOrderId);
      if (
        !before ||
        before.assignmentEpoch !== values.expectedAssignmentEpoch ||
        !["open", "changes_requested"].includes(before.status)
      )
        throw new DomainError("state_conflict", 409);
      if (before.assigneeId === values.technicianId) return before;
      const result = this.raw
        .prepare(
          `UPDATE assignments SET technician_id = ?, assignment_epoch = assignment_epoch + 1
           WHERE work_order_id = ? AND assignment_epoch = ?
             AND EXISTS (SELECT 1 FROM work_orders WHERE id = ? AND status IN ('open', 'changes_requested'))`,
        )
        .run(
          values.technicianId,
          values.workOrderId,
          values.expectedAssignmentEpoch,
          values.workOrderId,
        );
      if (result.changes !== 1) throw new DomainError("state_conflict", 409);
      this.raw
        .prepare(`INSERT INTO assignment_changes
        (work_order_id, previous_assignee, new_assignee, changed_by, changed_at, assignment_epoch)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          values.workOrderId,
          before.assigneeId,
          values.technicianId,
          values.principalId,
          new Date().toISOString(),
          before.assignmentEpoch + 1,
        );
      return this.findWorkOrder(values.workOrderId) as WorkOrder;
    })();
  }

  assignmentHistory(workOrderId: string): readonly AssignmentChange[] {
    return this.raw
      .prepare(`SELECT previous.name AS previousAssignee, next.name AS newAssignee,
      actor.name AS changedBy, c.changed_at AS changedAt, c.assignment_epoch AS assignmentEpoch
      FROM assignment_changes c
      JOIN users previous ON previous.id = c.previous_assignee
      JOIN users next ON next.id = c.new_assignee
      JOIN users actor ON actor.id = c.changed_by
      WHERE c.work_order_id = ? ORDER BY c.id DESC LIMIT 20`)
      .all(workOrderId) as AssignmentChange[];
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
    if (
      !values.checklist ||
      Object.keys(values.checklist).length !== checklistKeys.length ||
      checklistKeys.some((key) => typeof values.checklist[key] !== "boolean")
    ) {
      throw new DomainError("invalid_checklist", 400);
    }
    if (!validNotes(values.notes)) throw new DomainError("invalid_notes", 400);
    if (
      checklistKeys.some((key) => !values.checklist[key]) &&
      !values.notes.trim()
    )
      throw new DomainError("failure_notes_required", 400);
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
        !current ||
        !["open", "changes_requested"].includes(current.status) ||
        current.workOrderVersion !== values.expectedWorkOrderVersion ||
        current.assignmentEpoch !== values.capturedAssignmentEpoch
      ) {
        throw new DomainError("state_conflict", 409);
      }
      const update = this.raw
        .prepare(
          `UPDATE work_orders SET status = 'awaiting_review', work_order_version = work_order_version + 1
           WHERE id = ? AND status IN ('open', 'changes_requested') AND work_order_version = ?
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

  inspections(workOrderId: string): readonly Inspection[] {
    const rows = this.raw
      .prepare(`SELECT i.*, r.reviewed_by, r.outcome, r.notes AS review_notes, r.created_at AS reviewed_at
      FROM inspections i LEFT JOIN inspection_reviews r ON r.inspection_id = i.id
      WHERE i.work_order_id = ? ORDER BY i.rowid DESC LIMIT 20`)
      .all(workOrderId) as {
      id: string;
      work_order_id: string;
      submitted_by: string;
      checklist_json: string;
      notes: string;
      created_at: string;
      reviewed_by: string | null;
      outcome: InspectionReview["outcome"];
      review_notes: string;
      reviewed_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      workOrderId: row.work_order_id,
      submittedBy: row.submitted_by,
      checklist: JSON.parse(row.checklist_json) as Checklist,
      notes: row.notes,
      createdAt: row.created_at,
      ...(row.reviewed_by
        ? {
            review: {
              reviewedBy: row.reviewed_by,
              outcome: row.outcome,
              notes: row.review_notes,
              createdAt: row.reviewed_at,
            },
          }
        : {}),
    }));
  }

  review(
    values: InspectionReview & { principalId: string; workOrderId: string },
  ): { workOrder: WorkOrder; replayed: boolean } {
    if (!["complete", "request_corrections"].includes(values.outcome))
      throw new DomainError("invalid_review", 400);
    if (
      !validNotes(values.notes) ||
      (values.outcome === "request_corrections" && !values.notes.trim())
    )
      throw new DomainError("invalid_review_notes", 400);
    const requestHash = contentHash({
      action: "review",
      workOrderId: values.workOrderId,
      inspectionId: values.inspectionId,
      expectedWorkOrderVersion: values.expectedWorkOrderVersion,
      outcome: values.outcome,
      notes: values.notes,
    });
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
        )
          throw new DomainError("idempotency_conflict", 409);
        return { ...JSON.parse(prior.result_json), replayed: true } as {
          workOrder: WorkOrder;
          replayed: boolean;
        };
      }
      const current = this.findWorkOrder(values.workOrderId);
      const latest = this.inspections(values.workOrderId)[0];
      if (
        current?.status !== "awaiting_review" ||
        current.workOrderVersion !== values.expectedWorkOrderVersion ||
        latest?.id !== values.inspectionId ||
        latest.review
      )
        throw new DomainError("state_conflict", 409);
      if (
        values.outcome === "complete" &&
        checklistKeys.some((key) => !latest.checklist[key])
      )
        throw new DomainError("corrections_required", 409);
      this.raw
        .prepare(
          "INSERT INTO inspection_reviews (inspection_id, reviewed_by, outcome, notes, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          values.inspectionId,
          values.principalId,
          values.outcome,
          values.notes,
          new Date().toISOString(),
        );
      this.raw
        .prepare(
          "UPDATE work_orders SET status = ?, work_order_version = work_order_version + 1 WHERE id = ?",
        )
        .run(
          values.outcome === "complete" ? "completed" : "changes_requested",
          values.workOrderId,
        );
      const stored = {
        workOrder: this.findWorkOrder(values.workOrderId) as WorkOrder,
      };
      this.raw
        .prepare(
          "INSERT INTO idempotency_results (idempotency_key, principal_id, request_hash, result_json) VALUES (?, ?, ?, ?)",
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
