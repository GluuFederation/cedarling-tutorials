import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptJson, encryptJson, randomToken, tokenHash } from "./crypto.js";
import type { AppConfig } from "./config.js";
import type { OidcTokens } from "./oidc.js";

export type User = Readonly<{
  id: string;
  issuer: string;
  subject: string;
  name: string;
  tenantId: string;
  role: "contributor" | "owner" | "external";
  assuranceLevel: number;
}>;

export type Session = Readonly<{
  user: User;
  tokens: OidcTokens;
  csrfToken: string;
  expiresAt: number;
}>;
export type Task = Readonly<{
  id: string;
  tenantId: string;
  ownerId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "completed";
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,
  tenant_id TEXT NOT NULL, role TEXT NOT NULL, assurance_level INTEGER NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), encrypted_tokens TEXT NOT NULL,
  csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
);
`;

export class AppDatabase {
  readonly raw: Database.Database;

  constructor(filename: string, issuer: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.raw = new Database(filename);
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("journal_mode = WAL");
    this.raw.exec(schema);
    this.seed(issuer);
  }

  close(): void {
    this.raw.close();
  }

  private seed(issuer: string): void {
    const insertUser = this.raw.prepare(`INSERT OR IGNORE INTO users
      (id, issuer, subject, name, tenant_id, role, assurance_level) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertTask = this.raw.prepare(`INSERT OR IGNORE INTO tasks
      (id, tenant_id, owner_id, assignee_id, title, description, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const now = new Date("2026-08-25T00:00:00.000Z").toISOString();
    const transaction = this.raw.transaction(() => {
      insertUser.run(
        "user-alex",
        issuer,
        "alex",
        "Alex Morgan",
        "tenant-a",
        "contributor",
        1,
      );
      insertUser.run(
        "user-mina",
        issuer,
        "mina",
        "Mina Okafor",
        "tenant-a",
        "owner",
        2,
      );
      insertUser.run(
        "user-sam",
        issuer,
        "sam",
        "Sam Rivera",
        "tenant-b",
        "external",
        1,
      );
      insertTask.run(
        "task-a-brief",
        "tenant-a",
        "user-mina",
        "user-alex",
        "Prepare launch brief",
        "Summarize the P1 tutorial goals and open questions.",
        "in-progress",
        now,
        now,
      );
      insertTask.run(
        "task-a-review",
        "tenant-a",
        "user-mina",
        "user-mina",
        "Review policy model",
        "Confirm the future task capabilities and trusted facts.",
        "todo",
        now,
        now,
      );
      insertTask.run(
        "task-b-notes",
        "tenant-b",
        "user-sam",
        "user-sam",
        "Capture partner notes",
        "Record the external team feedback.",
        "todo",
        now,
        now,
      );
    });
    transaction();
  }

  createTransaction(values: {
    rawId: string;
    state: string;
    nonce: string;
    verifier: string;
    expiresAt: number;
  }): void {
    this.raw
      .prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
      .run(Date.now());
    this.raw
      .prepare(
        "INSERT INTO oidc_transactions (id_hash, state, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        tokenHash(values.rawId),
        values.state,
        values.nonce,
        values.verifier,
        values.expiresAt,
      );
  }

  consumeTransaction(
    rawId: string,
  ): { state: string; nonce: string; verifier: string } | undefined {
    const transaction = this.raw.transaction(() => {
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM oidc_transactions WHERE id_hash = ?",
        )
        .get(tokenHash(rawId)) as
        | { state: string; nonce: string; verifier: string; expires_at: number }
        | undefined;
      this.raw
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(tokenHash(rawId));
      if (!row || row.expires_at <= Date.now()) return undefined;
      return { state: row.state, nonce: row.nonce, verifier: row.verifier };
    });
    return transaction();
  }

  findUser(issuer: string, subject: string): User | undefined {
    return this.mapUser(
      this.raw
        .prepare("SELECT * FROM users WHERE issuer = ? AND subject = ?")
        .get(issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return this.mapUser(
      this.raw.prepare("SELECT * FROM users WHERE id = ?").get(id),
    );
  }

  private mapUser(value: unknown): User | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      issuer: String(row.issuer),
      subject: String(row.subject),
      name: String(row.name),
      tenantId: String(row.tenant_id),
      role: String(row.role) as User["role"],
      assuranceLevel: Number(row.assurance_level),
    };
  }

  createSession(
    userId: string,
    tokens: OidcTokens,
    config: AppConfig,
  ): { rawId: string; csrfToken: string } {
    const rawId = randomToken();
    const csrfToken = randomToken();
    this.raw
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    this.raw
      .prepare(
        "INSERT INTO sessions (id_hash, user_id, encrypted_tokens, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        tokenHash(rawId),
        userId,
        encryptJson(tokens, config.sessionEncryptionKey),
        csrfToken,
        Date.now() + 1_200_000,
      );
    return { rawId, csrfToken };
  }

  getSession(rawId: string, config: AppConfig): Session | undefined {
    const idHash = tokenHash(rawId);
    const row = this.raw
      .prepare(
        `SELECT s.encrypted_tokens, s.csrf_token, s.expires_at, u.* FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
      )
      .get(idHash) as Record<string, unknown> | undefined;
    if (!row || Number(row.expires_at) <= Date.now()) {
      this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
      return undefined;
    }
    const user = this.mapUser(row);
    if (!user) return undefined;
    try {
      const tokens = decryptJson<OidcTokens>(
        String(row.encrypted_tokens),
        config.sessionEncryptionKey,
      );
      if (
        typeof tokens.accessToken !== "string" ||
        typeof tokens.accessTokenExpiresAt !== "number" ||
        typeof tokens.refreshToken !== "string" ||
        typeof tokens.refreshTokenExpiresAt !== "number" ||
        typeof tokens.idToken !== "string" ||
        typeof tokens.idTokenExpiresAt !== "number"
      ) {
        throw new Error("Invalid stored OIDC tokens");
      }
      return {
        user,
        tokens,
        csrfToken: String(row.csrf_token),
        expiresAt: Number(row.expires_at),
      };
    } catch {
      this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
      return undefined;
    }
  }

  updateSessionTokens(
    rawId: string,
    tokens: OidcTokens,
    config: AppConfig,
  ): void {
    this.raw
      .prepare("UPDATE sessions SET encrypted_tokens = ? WHERE id_hash = ?")
      .run(encryptJson(tokens, config.sessionEncryptionKey), tokenHash(rawId));
  }

  deleteSession(rawId: string): void {
    this.raw
      .prepare("DELETE FROM sessions WHERE id_hash = ?")
      .run(tokenHash(rawId));
  }

  listTasks(tenantId: string): Task[] {
    return (
      this.raw
        .prepare(
          "SELECT * FROM tasks WHERE tenant_id = ? ORDER BY updated_at DESC, id",
        )
        .all(tenantId) as unknown[]
    ).map((row) => this.mapTask(row));
  }

  getTask(id: string): Task | undefined {
    const row = this.raw.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? this.mapTask(row) : undefined;
  }

  createTask(user: User, title: string, description: string): Task {
    const id = `task-${randomToken(9)}`;
    const now = new Date().toISOString();
    this.raw
      .prepare(
        `INSERT INTO tasks
      (id, tenant_id, owner_id, assignee_id, title, description, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'todo', 1, ?, ?)`,
      )
      .run(id, user.tenantId, user.id, user.id, title, description, now, now);
    return this.getTask(id)!;
  }

  editTask(
    id: string,
    version: number,
    title: string,
    description: string,
  ): Task | "conflict" | undefined {
    if (!this.getTask(id)) return undefined;
    const result = this.raw
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`,
      )
      .run(title, description, new Date().toISOString(), id, version);
    return result.changes === 0 ? "conflict" : this.getTask(id);
  }

  assignTask(
    id: string,
    version: number,
    assigneeId: string,
  ): Task | "conflict" | undefined {
    if (!this.getTask(id) || !this.findUserById(assigneeId)) return undefined;
    const result = this.raw
      .prepare(
        `UPDATE tasks SET assignee_id = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`,
      )
      .run(assigneeId, new Date().toISOString(), id, version);
    return result.changes === 0 ? "conflict" : this.getTask(id);
  }

  completeTask(id: string, version: number): Task | "conflict" | undefined {
    if (!this.getTask(id)) return undefined;
    const result = this.raw
      .prepare(
        `UPDATE tasks SET status = 'completed', version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`,
      )
      .run(new Date().toISOString(), id, version);
    return result.changes === 0 ? "conflict" : this.getTask(id);
  }

  deleteTask(id: string, version: number): "deleted" | "conflict" | undefined {
    if (!this.getTask(id)) return undefined;
    const result = this.raw
      .prepare("DELETE FROM tasks WHERE id = ? AND version = ?")
      .run(id, version);
    return result.changes === 0 ? "conflict" : "deleted";
  }

  private mapTask(value: unknown): Task {
    const row = value as Record<string, unknown>;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      ownerId: String(row.owner_id),
      assigneeId: row.assignee_id ? String(row.assignee_id) : null,
      title: String(row.title),
      description: String(row.description),
      status: String(row.status) as Task["status"],
      version: Number(row.version),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
