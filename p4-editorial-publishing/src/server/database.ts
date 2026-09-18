import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { contentDigest } from "./crypto.ts";
import { conflict, notFound } from "./errors.ts";
import type {
  ArticleSummary,
  ArticleView,
  OidcTransaction,
  Principal,
  RevisionState,
  RevisionView,
  Session,
} from "./models.ts";

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS authorities (
  principal_id TEXT NOT NULL REFERENCES principals(id),
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'publisher')),
  revoked_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (principal_id, tenant_id, role)
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  current_revision_id TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  digest TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES principals(id),
  state TEXT NOT NULL CHECK (state IN ('draft','submitted','approved','rejected','published')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (article_id, version)
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL UNIQUE REFERENCES revisions(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES principals(id),
  digest TEXT NOT NULL,
  revision_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL UNIQUE REFERENCES revisions(id),
  published_by TEXT NOT NULL REFERENCES principals(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principals(id),
  csrf_token TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS revisions_article ON revisions(article_id, version DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`;

type ArticleRow = {
  id: string;
  tenant_id: string;
  article_version: number;
  current_revision_id: string;
  revision_id: string;
  revision_version: number;
  title: string;
  body: string;
  digest: string;
  author_id: string;
  author_name: string;
  state: RevisionState;
};

export function resetDatabase(dataDirectory: string, issuer: string): void {
  const databasePath = resolve(dataDirectory, "p4.sqlite");
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
  new AppDatabase(dataDirectory, issuer).close();
}

export class AppDatabase {
  private readonly connection: Database.Database;

  constructor(dataDirectory: string, issuer: string) {
    this.connection = new Database(resolve(dataDirectory, "p4.sqlite"));
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 3000");
    this.connection.exec(schema);
    this.seed(issuer);
  }

  close(): void {
    this.connection.close();
  }

  seed(issuer: string): void {
    const existing = this.connection
      .prepare("SELECT count(*) AS count FROM principals")
      .get() as { count: number };
    if (existing.count > 0) return;
    this.connection.transaction(() => {
      const principal = this.connection.prepare(
        "INSERT INTO principals (id, issuer, subject, name, tenant_id) VALUES (?, ?, ?, ?, ?)",
      );
      principal.run("user-riley", issuer, "riley", "Riley", "tenant-a");
      principal.run("user-ana", issuer, "ana", "Ana", "tenant-a");
      principal.run("user-omar", issuer, "omar", "Omar", "tenant-a");
      principal.run(
        "user-tenant-b",
        issuer,
        "tenant-b-editor",
        "Tenant B Editor",
        "tenant-b",
      );

      const authority = this.connection.prepare(
        "INSERT INTO authorities (principal_id, tenant_id, role) VALUES (?, ?, ?)",
      );
      authority.run("user-ana", "tenant-a", "editor");
      authority.run("user-ana", "tenant-a", "publisher");
      authority.run("user-omar", "tenant-a", "editor");

      this.seedArticle(
        "article-launch-brief",
        "tenant-a",
        "revision-launch-1",
        "Launch brief",
        "Shape the launch brief for editorial review.",
        "draft",
        "user-riley",
      );
      this.seedArticle(
        "article-migration-guide",
        "tenant-a",
        "revision-migration-1",
        "Customer migration guide",
        "A concise guide for customers moving to the new platform.",
        "submitted",
        "user-riley",
      );
      this.seedArticle(
        "article-partner-announcement",
        "tenant-a",
        "revision-partner-1",
        "Partner announcement",
        "Announce the new partner program after editorial approval.",
        "submitted",
        "user-riley",
      );
      this.seedArticle(
        "article-editorial-handbook",
        "tenant-a",
        "revision-handbook-1",
        "Editorial handbook",
        "The concise handbook for the editorial team.",
        "submitted",
        "user-riley",
      );
      this.seedArticle(
        "article-private-tenant-b",
        "tenant-b",
        "revision-private-b-1",
        "Tenant B private brief",
        "This article must not be disclosed to Tenant A.",
        "submitted",
        "user-tenant-b",
      );
    })();
  }

  private seedArticle(
    articleId: string,
    tenantId: string,
    revisionId: string,
    title: string,
    body: string,
    state: RevisionState,
    authorId: string,
  ): void {
    const now = "2026-09-17T08:00:00.000Z";
    this.connection
      .prepare("INSERT INTO articles (id, tenant_id, version) VALUES (?, ?, 1)")
      .run(articleId, tenantId);
    this.connection
      .prepare(
        `INSERT INTO revisions
         (id, article_id, version, title, body, digest, author_id, state, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        articleId,
        title,
        body,
        contentDigest(title, body),
        authorId,
        state,
        now,
        now,
      );
    this.connection
      .prepare("UPDATE articles SET current_revision_id = ? WHERE id = ?")
      .run(revisionId, articleId);
  }

  principal(issuer: string, subject: string): Principal | undefined {
    const row = this.connection
      .prepare(
        `SELECT id, issuer, subject, name, tenant_id AS tenantId
         FROM principals WHERE issuer = ? AND subject = ?`,
      )
      .get(issuer, subject);
    return row as Principal | undefined;
  }

  listArticles(tenantId: string): ArticleSummary[] {
    return this.connection
      .prepare(
        `SELECT a.id, r.title, r.state, r.version
         FROM articles a JOIN revisions r ON r.id = a.current_revision_id
         WHERE a.tenant_id = ? ORDER BY r.title LIMIT 50`,
      )
      .all(tenantId) as ArticleSummary[];
  }

  article(
    articleId: string,
    tenantId: string,
    revisionId?: string,
  ): ArticleView | undefined {
    const row = this.connection
      .prepare(
        `SELECT a.id, a.tenant_id, a.version AS article_version,
                a.current_revision_id, r.id AS revision_id,
                r.version AS revision_version, r.title, r.body, r.digest,
                r.author_id, p.name AS author_name, r.state
         FROM articles a
         JOIN revisions r ON r.id = COALESCE(?, a.current_revision_id)
           AND r.article_id = a.id
         JOIN principals p ON p.id = r.author_id
         WHERE a.id = ? AND a.tenant_id = ?`,
      )
      .get(revisionId ?? null, articleId, tenantId) as ArticleRow | undefined;
    if (!row) return undefined;
    const revisions = this.connection
      .prepare(
        `SELECT id, version, state FROM revisions
         WHERE article_id = ? ORDER BY version DESC LIMIT 20`,
      )
      .all(articleId) as ArticleView["revisions"];
    const review = this.connection
      .prepare(
        `SELECT p.name AS reviewerName, rv.decision,
                CASE WHEN au.principal_id IS NOT NULL AND au.revoked_at IS NULL
                     THEN 1 ELSE 0 END AS authorityCurrent
         FROM reviews rv JOIN principals p ON p.id = rv.reviewer_id
         LEFT JOIN authorities au ON au.principal_id = rv.reviewer_id
           AND au.tenant_id = ? AND au.role = 'editor'
         WHERE rv.revision_id = ?`,
      )
      .get(row.tenant_id, row.revision_id) as
      | (Omit<NonNullable<ArticleView["review"]>, "authorityCurrent"> & {
          authorityCurrent: number;
        })
      | undefined;
    const published = Boolean(
      this.connection
        .prepare("SELECT 1 FROM publications WHERE revision_id = ?")
        .get(row.revision_id),
    );
    return {
      id: row.id,
      tenantId: row.tenant_id,
      version: row.article_version,
      currentRevisionId: row.current_revision_id,
      revision: this.revisionFromRow(row),
      revisions,
      review: review
        ? { ...review, authorityCurrent: Boolean(review.authorityCurrent) }
        : undefined,
      published,
    };
  }

  private revisionFromRow(row: ArticleRow): RevisionView {
    return {
      id: row.revision_id,
      version: row.revision_version,
      title: row.title,
      body: row.body,
      digest: row.digest,
      authorId: row.author_id,
      authorName: row.author_name,
      state: row.state,
    };
  }

  hasCurrentAuthority(
    principalId: string,
    tenantId: string,
    role: "editor" | "publisher",
  ): boolean {
    return Boolean(
      this.connection
        .prepare(
          `SELECT 1 FROM authorities
           WHERE principal_id = ? AND tenant_id = ? AND role = ? AND revoked_at IS NULL`,
        )
        .get(principalId, tenantId, role),
    );
  }

  saveDraft(input: {
    articleId: string;
    tenantId: string;
    actorId: string;
    expectedVersion: number;
    title: string;
    body: string;
  }): string {
    return this.connection.transaction(() => {
      const current = this.article(input.articleId, input.tenantId);
      if (!current) throw notFound();
      if (current.version !== input.expectedVersion) throw conflict();
      const now = new Date().toISOString();
      const digest = contentDigest(input.title, input.body);
      if (current.revision.state === "draft") {
        this.connection
          .prepare(
            `UPDATE revisions SET title = ?, body = ?, digest = ?, updated_at = ?
             WHERE id = ? AND state = 'draft'`,
          )
          .run(input.title, input.body, digest, now, current.revision.id);
        this.bumpArticle(input.articleId, input.expectedVersion);
        return current.revision.id;
      }
      if (current.revisions.length >= 20)
        throw conflict("This article already has 20 revisions");
      const id = `revision-${randomUUID()}`;
      const latest = current.revisions[0];
      if (!latest) throw conflict("The article has no current revision");
      const version = latest.version + 1;
      this.connection
        .prepare(
          `INSERT INTO revisions
           (id, article_id, version, title, body, digest, author_id, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        )
        .run(
          id,
          input.articleId,
          version,
          input.title,
          input.body,
          digest,
          input.actorId,
          now,
          now,
        );
      const changed = this.connection
        .prepare(
          `UPDATE articles SET current_revision_id = ?, version = version + 1
           WHERE id = ? AND version = ?`,
        )
        .run(id, input.articleId, input.expectedVersion);
      if (changed.changes !== 1) throw conflict();
      return id;
    })();
  }

  submit(
    articleId: string,
    tenantId: string,
    revisionId: string,
    expectedVersion: number,
  ): void {
    this.transition(
      articleId,
      tenantId,
      revisionId,
      expectedVersion,
      "draft",
      "submitted",
    );
  }

  review(
    articleId: string,
    tenantId: string,
    revisionId: string,
    reviewerId: string,
    expectedVersion: number,
    decision: "approved" | "rejected",
  ): void {
    this.connection.transaction(() => {
      const current = this.article(articleId, tenantId);
      if (!current) throw notFound();
      if (
        current.version !== expectedVersion ||
        current.currentRevisionId !== revisionId ||
        current.revision.state !== "submitted"
      ) {
        throw conflict();
      }
      this.connection
        .prepare(
          `INSERT INTO reviews
           (id, article_id, revision_id, reviewer_id, digest, revision_version, decision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `review-${randomUUID()}`,
          articleId,
          revisionId,
          reviewerId,
          current.revision.digest,
          current.revision.version,
          decision,
          new Date().toISOString(),
        );
      this.connection
        .prepare("UPDATE revisions SET state = ?, updated_at = ? WHERE id = ?")
        .run(decision, new Date().toISOString(), revisionId);
      this.bumpArticle(articleId, expectedVersion);
    })();
  }

  latestApproval(articleId: string):
    | {
        revisionId: string;
        revisionVersion: number;
        digest: string;
        reviewerId: string;
        authorityCurrent: boolean;
      }
    | undefined {
    const row = this.connection
      .prepare(
        `SELECT rv.revision_id AS revisionId, rv.revision_version AS revisionVersion,
                rv.digest, rv.reviewer_id AS reviewerId,
                CASE WHEN au.principal_id IS NOT NULL AND au.revoked_at IS NULL
                     THEN 1 ELSE 0 END AS authorityCurrent
         FROM reviews rv
         JOIN articles a ON a.id = rv.article_id
         LEFT JOIN authorities au ON au.principal_id = rv.reviewer_id
           AND au.tenant_id = a.tenant_id AND au.role = 'editor'
         WHERE rv.article_id = ? AND rv.decision = 'approved'
         ORDER BY rv.created_at DESC LIMIT 1`,
      )
      .get(articleId) as
      | {
          revisionId: string;
          revisionVersion: number;
          digest: string;
          reviewerId: string;
          authorityCurrent: number;
        }
      | undefined;
    return row
      ? { ...row, authorityCurrent: Boolean(row.authorityCurrent) }
      : undefined;
  }

  publish(
    articleId: string,
    tenantId: string,
    actorId: string,
    expectedVersion: number,
  ): string {
    return this.connection.transaction(() => {
      const current = this.article(articleId, tenantId);
      if (!current) throw notFound();
      if (current.version !== expectedVersion) throw conflict();
      if (!["submitted", "approved"].includes(current.revision.state))
        throw conflict("Only a reviewable revision can be published");
      if (!this.latestApproval(articleId))
        throw conflict("An approval is required before publication");
      if (current.published)
        throw conflict("This revision is already published");
      const id = `publication-${randomUUID()}`;
      const now = new Date().toISOString();
      this.connection
        .prepare(
          `INSERT INTO publications (id, article_id, revision_id, published_by, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, articleId, current.currentRevisionId, actorId, now);
      this.connection
        .prepare(
          "UPDATE revisions SET state = 'published', updated_at = ? WHERE id = ?",
        )
        .run(now, current.currentRevisionId);
      this.bumpArticle(articleId, expectedVersion);
      return id;
    })();
  }

  private transition(
    articleId: string,
    tenantId: string,
    revisionId: string,
    expectedVersion: number,
    from: RevisionState,
    to: RevisionState,
  ): void {
    this.connection.transaction(() => {
      const current = this.article(articleId, tenantId);
      if (!current) throw notFound();
      if (
        current.version !== expectedVersion ||
        current.currentRevisionId !== revisionId ||
        current.revision.state !== from
      ) {
        throw conflict();
      }
      this.connection
        .prepare("UPDATE revisions SET state = ?, updated_at = ? WHERE id = ?")
        .run(to, new Date().toISOString(), revisionId);
      this.bumpArticle(articleId, expectedVersion);
    })();
  }

  private bumpArticle(articleId: string, expectedVersion: number): void {
    const result = this.connection
      .prepare(
        "UPDATE articles SET version = version + 1 WHERE id = ? AND version = ?",
      )
      .run(articleId, expectedVersion);
    if (result.changes !== 1) throw conflict();
  }

  revokeOmar(): boolean {
    const result = this.connection
      .prepare(
        `UPDATE authorities SET revoked_at = ?, version = version + 1
         WHERE principal_id = 'user-omar' AND tenant_id = 'tenant-a'
           AND role = 'editor' AND revoked_at IS NULL`,
      )
      .run(new Date().toISOString());
    return result.changes === 1;
  }

  createSession(input: {
    idHash: string;
    principalId: string;
    csrfToken: string;
    encryptedTokens: string;
    expiresAt: number;
  }): void {
    this.connection
      .prepare(
        `INSERT INTO sessions (id_hash, principal_id, csrf_token, encrypted_tokens, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.idHash,
        input.principalId,
        input.csrfToken,
        input.encryptedTokens,
        input.expiresAt,
      );
  }

  session(
    idHash: string,
  ): (Session & { idHash: string; encryptedTokens: string }) | undefined {
    this.connection
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    const row = this.connection
      .prepare(
        `SELECT s.id_hash AS idHash, s.csrf_token AS csrfToken,
                s.encrypted_tokens AS encryptedTokens,
                p.id, p.issuer, p.subject, p.name, p.tenant_id AS tenantId
         FROM sessions s JOIN principals p ON p.id = s.principal_id
         WHERE s.id_hash = ?`,
      )
      .get(idHash) as
      | {
          idHash: string;
          csrfToken: string;
          encryptedTokens: string;
          id: string;
          issuer: string;
          subject: string;
          name: string;
          tenantId: string;
        }
      | undefined;
    return row
      ? {
          idHash: row.idHash,
          csrfToken: row.csrfToken,
          encryptedTokens: row.encryptedTokens,
          principal: {
            id: row.id,
            issuer: row.issuer,
            subject: row.subject,
            name: row.name,
            tenantId: row.tenantId,
          },
        }
      : undefined;
  }

  deleteSession(idHash: string): void {
    this.connection
      .prepare("DELETE FROM sessions WHERE id_hash = ?")
      .run(idHash);
  }

  createTransaction(idHash: string, value: OidcTransaction): void {
    this.connection
      .prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
      .run(Date.now());
    this.connection
      .prepare(
        `INSERT INTO oidc_transactions (id_hash, state, nonce, verifier, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(idHash, value.state, value.nonce, value.verifier, value.expiresAt);
  }

  consumeTransaction(idHash: string): OidcTransaction | undefined {
    return this.connection.transaction(() => {
      const row = this.connection
        .prepare(
          `SELECT state, nonce, verifier, expires_at AS expiresAt
           FROM oidc_transactions WHERE id_hash = ? AND expires_at > ?`,
        )
        .get(idHash, Date.now()) as OidcTransaction | undefined;
      this.connection
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(idHash);
      return row;
    })();
  }
}
