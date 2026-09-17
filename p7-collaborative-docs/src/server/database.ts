import { randomUUID } from "node:crypto";
import Sqlite from "better-sqlite3";
import { tutorialUsers } from "../shared/catalog.ts";
import type {
  DocumentComment,
  DocumentMember,
  DocumentRole,
  DocumentSummary,
  User,
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

export type StoredDocument = Readonly<{
  id: string;
  title: string;
  content: string;
  ownerId: string;
  ownerName: string;
  role: DocumentRole | null;
  documentVersion: number;
  accessVersion: number;
  updatedAt: string;
}>;

export type DocumentRelations = Readonly<{
  members: readonly DocumentMember[];
  comments: readonly DocumentComment[];
}>;

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  owner_id: string;
  owner_name: string;
  role: DocumentRole | null;
  document_version: number;
  access_version: number;
  updated_at: string;
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  document_version INTEGER NOT NULL CHECK (document_version > 0),
  access_version INTEGER NOT NULL CHECK (access_version > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_members (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'commenter')),
  PRIMARY KEY (document_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS comments_by_document
  ON comments(document_id, created_at);
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
        DELETE FROM comments;
        DELETE FROM document_members;
        DELETE FROM documents;
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
      "INSERT INTO users (id, issuer, subject, name) VALUES (?, ?, ?, ?)",
    );
    for (const user of tutorialUsers) {
      insertUser.run(user.id, issuer, user.subject, user.name);
    }
    const insertDocument = this.raw.prepare(
      `INSERT INTO documents
       (id, title, content, owner_id, document_version, access_version, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`,
    );
    const now = "2026-09-01T09:00:00.000Z";
    insertDocument.run(
      "doc-launch-brief",
      "Launch brief",
      "Coordinate the launch message, customer checklist, and release-day owners.",
      "user-maya",
      now,
    );
    insertDocument.run(
      "doc-private-planning",
      "Maya's private planning",
      "Private staffing notes for Maya's launch preparation.",
      "user-maya",
      now,
    );
    const addMember = this.raw.prepare(
      "INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)",
    );
    addMember.run("doc-launch-brief", "user-maya", "owner");
    addMember.run("doc-launch-brief", "user-noah", "editor");
    addMember.run("doc-launch-brief", "user-lena", "commenter");
    addMember.run("doc-private-planning", "user-maya", "owner");
    this.raw
      .prepare(
        "INSERT INTO comments (id, document_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "comment-launch-checklist",
        "doc-launch-brief",
        "user-lena",
        "I added the customer-support checkpoint.",
        "2026-09-01T09:15:00.000Z",
      );
  }

  findUser(issuer: string, subject: string): User | undefined {
    return mapUser(
      this.raw
        .prepare("SELECT id, name FROM users WHERE issuer = ? AND subject = ?")
        .get(issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return mapUser(
      this.raw.prepare("SELECT id, name FROM users WHERE id = ?").get(id),
    );
  }

  listUsers(): readonly User[] {
    return (
      this.raw
        .prepare("SELECT id, name FROM users ORDER BY name")
        .all() as unknown[]
    )
      .map(mapUser)
      .filter((user): user is User => user !== undefined);
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
      const idHash = tokenHash(id);
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM oidc_transactions WHERE id_hash = ?",
        )
        .get(idHash) as
        | { state: string; nonce: string; verifier: string; expires_at: number }
        | undefined;
      this.raw
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(idHash);
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
        `SELECT s.csrf_token, s.expires_at, u.id, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ?`,
      )
      .get(tokenHash(id)) as
      | { csrf_token: string; expires_at: number; id: string; name: string }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at <= now) {
      this.destroySession(id);
      return undefined;
    }
    return {
      user: { id: row.id, name: row.name },
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

  listDocuments(viewerId: string): readonly DocumentSummary[] {
    const rows = this.raw
      .prepare(
        `${documentSelect}
         LEFT JOIN document_members viewer
           ON viewer.document_id = d.id AND viewer.user_id = ?
         ORDER BY d.updated_at DESC, d.title LIMIT 20`,
      )
      .all(viewerId) as DocumentRow[];
    return rows.map(mapSummary);
  }

  findDocument(id: string, viewerId: string): StoredDocument | undefined {
    const row = this.raw
      .prepare(
        `${documentSelect}
         LEFT JOIN document_members viewer
           ON viewer.document_id = d.id AND viewer.user_id = ?
         WHERE d.id = ?`,
      )
      .get(viewerId, id) as DocumentRow | undefined;
    if (!row) return undefined;
    return {
      ...mapSummary(row),
      content: row.content,
    };
  }

  documentRelations(id: string): DocumentRelations {
    return { members: this.members(id), comments: this.comments(id) };
  }

  createDocument(
    ownerId: string,
    title: string,
    content: string,
  ): DocumentSummary {
    const id = `doc-${randomUUID()}`;
    const now = new Date().toISOString();
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO documents
           (id, title, content, owner_id, document_version, access_version, updated_at)
           VALUES (?, ?, ?, ?, 1, 1, ?)`,
        )
        .run(id, title, content, ownerId, now);
      this.raw
        .prepare(
          "INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, 'owner')",
        )
        .run(id, ownerId);
    })();
    const created = this.findDocument(id, ownerId);
    if (!created) throw new Error("Created document disappeared");
    return {
      id: created.id,
      title: created.title,
      ownerId: created.ownerId,
      ownerName: created.ownerName,
      role: created.role,
      documentVersion: created.documentVersion,
      accessVersion: created.accessVersion,
      updatedAt: created.updatedAt,
    };
  }

  updateDocument(values: {
    documentId: string;
    expectedDocumentVersion: number;
    title: string;
    content: string;
  }): void {
    const result = this.raw
      .prepare(
        `UPDATE documents
         SET title = ?, content = ?, document_version = document_version + 1,
             updated_at = ?
         WHERE id = ? AND document_version = ?`,
      )
      .run(
        values.title,
        values.content,
        new Date().toISOString(),
        values.documentId,
        values.expectedDocumentVersion,
      );
    if (result.changes !== 1) throw new DomainError("state_conflict", 409);
  }

  addComment(values: {
    documentId: string;
    principalId: string;
    idempotencyKey: string;
    body: string;
  }): { comment: DocumentComment; replayed: boolean } {
    const requestHash = contentHash({
      documentId: values.documentId,
      body: values.body,
    });
    return this.raw.transaction(() => {
      const existing = this.raw
        .prepare(
          "SELECT principal_id, request_hash, result_json FROM idempotency_results WHERE idempotency_key = ?",
        )
        .get(values.idempotencyKey) as
        | { principal_id: string; request_hash: string; result_json: string }
        | undefined;
      if (existing) {
        if (
          existing.principal_id !== values.principalId ||
          existing.request_hash !== requestHash
        ) {
          throw new DomainError("idempotency_conflict", 409);
        }
        return {
          ...(JSON.parse(existing.result_json) as { comment: DocumentComment }),
          replayed: true,
        };
      }
      const comment: DocumentComment = {
        id: `comment-${randomUUID()}`,
        authorId: values.principalId,
        authorName: this.findUserById(values.principalId)?.name ?? "Unknown",
        body: values.body,
        createdAt: new Date().toISOString(),
      };
      this.raw
        .prepare(
          "INSERT INTO comments (id, document_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          comment.id,
          values.documentId,
          comment.authorId,
          comment.body,
          comment.createdAt,
        );
      this.raw
        .prepare(
          "INSERT INTO idempotency_results (idempotency_key, principal_id, request_hash, result_json) VALUES (?, ?, ?, ?)",
        )
        .run(
          values.idempotencyKey,
          values.principalId,
          requestHash,
          JSON.stringify({ comment }),
        );
      return { comment, replayed: false };
    })();
  }

  setAccess(values: {
    documentId: string;
    userId: string;
    role: Exclude<DocumentRole, "owner">;
    expectedAccessVersion: number;
  }): void {
    this.raw.transaction(() => {
      this.requireMutableMember(values.documentId, values.userId);
      const result = this.raw
        .prepare(
          `UPDATE documents SET access_version = access_version + 1
           WHERE id = ? AND access_version = ?`,
        )
        .run(values.documentId, values.expectedAccessVersion);
      if (result.changes !== 1) throw new DomainError("state_conflict", 409);
      this.raw
        .prepare(
          `INSERT INTO document_members (document_id, user_id, role) VALUES (?, ?, ?)
           ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`,
        )
        .run(values.documentId, values.userId, values.role);
    })();
  }

  removeAccess(values: {
    documentId: string;
    userId: string;
    expectedAccessVersion: number;
  }): void {
    this.raw.transaction(() => {
      this.requireMutableMember(values.documentId, values.userId);
      const result = this.raw
        .prepare(
          `UPDATE documents SET access_version = access_version + 1
           WHERE id = ? AND access_version = ?`,
        )
        .run(values.documentId, values.expectedAccessVersion);
      if (result.changes !== 1) throw new DomainError("state_conflict", 409);
      const deleted = this.raw
        .prepare(
          "DELETE FROM document_members WHERE document_id = ? AND user_id = ?",
        )
        .run(values.documentId, values.userId);
      if (deleted.changes !== 1) throw new DomainError("member_not_found", 404);
    })();
  }

  private requireMutableMember(documentId: string, userId: string): void {
    if (!this.findUserById(userId)) throw new DomainError("invalid_user", 400);
    const row = this.raw
      .prepare("SELECT owner_id FROM documents WHERE id = ?")
      .get(documentId) as { owner_id: string } | undefined;
    if (!row) throw new DomainError("not_found", 404);
    if (row.owner_id === userId)
      throw new DomainError("owner_is_immutable", 409);
  }

  private members(documentId: string): readonly DocumentMember[] {
    return this.raw
      .prepare(
        `SELECT m.user_id, u.name, m.role
         FROM document_members m JOIN users u ON u.id = m.user_id
         WHERE m.document_id = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
      )
      .all(documentId)
      .map((value) => {
        const row = value as {
          user_id: string;
          name: string;
          role: DocumentRole;
        };
        return { userId: row.user_id, name: row.name, role: row.role };
      });
  }

  private comments(documentId: string): readonly DocumentComment[] {
    return this.raw
      .prepare(
        `SELECT c.id, c.author_id, u.name AS author_name, c.body, c.created_at
         FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.document_id = ? ORDER BY c.created_at LIMIT 50`,
      )
      .all(documentId)
      .map((value) => {
        const row = value as {
          id: string;
          author_id: string;
          author_name: string;
          body: string;
          created_at: string;
        };
        return {
          id: row.id,
          authorId: row.author_id,
          authorName: row.author_name,
          body: row.body,
          createdAt: row.created_at,
        };
      });
  }
}

const documentSelect = `
  SELECT d.id, d.title, d.content, d.owner_id, owner.name AS owner_name,
         viewer.role, d.document_version, d.access_version,
         d.updated_at
  FROM documents d JOIN users owner ON owner.id = d.owner_id`;

function mapUser(value: unknown): User | undefined {
  const row = value as Record<string, unknown> | undefined;
  return row ? { id: String(row.id), name: String(row.name) } : undefined;
}

function mapSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role: row.role,
    documentVersion: row.document_version,
    accessVersion: row.access_version,
    updatedAt: row.updated_at,
  };
}
