import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Sqlite from "better-sqlite3";
import type {
  Analyst,
  ExportState,
  ExportSummary,
  Purpose,
  QueryPlan,
} from "../shared/contracts.ts";
import type { AppConfig } from "./config.ts";
import {
  decryptJson,
  digestJson,
  encryptJson,
  randomToken,
  tokenHash,
} from "./crypto.ts";
import { workforceFixtures } from "./fixtures.ts";
import type { OidcTokens } from "./oidc.ts";
import type { CompiledQuery } from "./query.ts";

type InternalAnalyst = Analyst & Readonly<{ issuer: string; subject: string }>;
export type Session = Readonly<{
  user: InternalAnalyst;
  tokens: OidcTokens;
  csrfToken: string;
  expiresAt: number;
}>;

export type ExportRecord = ExportSummary &
  Readonly<{
    downloadHash: string;
    plan: QueryPlan;
    planDigest: string;
    filePath: string | null;
  }>;

export type QueryEvaluation = Readonly<{
  rows: Array<Record<string, string | number | null>>;
  matchingCount: number;
  minimumGroupSize: number;
}>;

const schema = `
CREATE TABLE IF NOT EXISTS analysts (
  id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
  name TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS workforce (
  employee_id TEXT PRIMARY KEY, full_name TEXT NOT NULL, work_email TEXT NOT NULL,
  department TEXT NOT NULL, location TEXT NOT NULL, support_tier TEXT NOT NULL,
  employment_status TEXT NOT NULL, salary INTEGER NOT NULL, bonus INTEGER NOT NULL,
  tenant_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL,
  verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, analyst_id TEXT NOT NULL REFERENCES analysts(id),
  encrypted_tokens TEXT NOT NULL, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES analysts(id),
  purpose TEXT NOT NULL, plan_json TEXT NOT NULL, download_hash TEXT NOT NULL UNIQUE,
  plan_digest TEXT NOT NULL, file_path TEXT, state TEXT NOT NULL,
  row_count INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
`;

export class AppDatabase {
  private readonly raw: Sqlite.Database;
  readonly exportDirectory: string;

  constructor(filename: string, issuer: string, exportDirectory: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    mkdirSync(exportDirectory, { recursive: true, mode: 0o700 });
    this.exportDirectory = exportDirectory;
    this.raw = new Sqlite(filename);
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("journal_mode = WAL");
    this.raw.exec(schema);
    this.raw
      .prepare(
        "DELETE FROM exports WHERE state NOT IN ('ready', 'expired', 'revoked')",
      )
      .run();
    this.seed(issuer);
  }

  close(): void {
    this.raw.close();
  }

  private seed(issuer: string): void {
    const addUser = this.raw.prepare(
      "INSERT OR IGNORE INTO analysts (id, issuer, subject, name, tenant_id, role) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const addWorkforce = this.raw.prepare(
      `INSERT OR IGNORE INTO workforce
      (employee_id, full_name, work_email, department, location, support_tier,
       employment_status, salary, bonus, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.raw.transaction(() => {
      addUser.run(
        "analyst-amina",
        issuer,
        "amina",
        "Amina",
        "tenant-a",
        "Support analyst",
      );
      addUser.run(
        "analyst-leah",
        issuer,
        "leah",
        "Leah",
        "tenant-a",
        "Finance lead",
      );
      addUser.run(
        "analyst-theo",
        issuer,
        "theo",
        "Theo",
        "tenant-b",
        "External reviewer",
      );
      for (const fixture of workforceFixtures) addWorkforce.run(...fixture);
    })();
  }

  findAnalyst(issuer: string, subject: string): InternalAnalyst | undefined {
    return this.mapAnalyst(
      this.raw
        .prepare("SELECT * FROM analysts WHERE issuer = ? AND subject = ?")
        .get(issuer, subject),
    );
  }

  private mapAnalyst(value: unknown): InternalAnalyst | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      issuer: String(row.issuer),
      subject: String(row.subject),
      name: String(row.name),
      tenantId: String(row.tenant_id),
      role: String(row.role),
    };
  }

  createTransaction(value: {
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
      .prepare("INSERT INTO oidc_transactions VALUES (?, ?, ?, ?, ?)")
      .run(
        tokenHash(value.rawId),
        value.state,
        value.nonce,
        value.verifier,
        value.expiresAt,
      );
  }

  consumeTransaction(
    rawId: string,
  ): { state: string; nonce: string; verifier: string } | undefined {
    const hash = tokenHash(rawId);
    return this.raw.transaction(() => {
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM oidc_transactions WHERE id_hash = ?",
        )
        .get(hash) as Record<string, unknown> | undefined;
      this.raw
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(hash);
      if (!row || Number(row.expires_at) <= Date.now()) return undefined;
      return {
        state: String(row.state),
        nonce: String(row.nonce),
        verifier: String(row.verifier),
      };
    })();
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
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)")
      .run(
        tokenHash(rawId),
        userId,
        encryptJson(tokens, config.sessionEncryptionKey),
        csrfToken,
        Date.now() + 1_800_000,
      );
    return { rawId, csrfToken };
  }

  getSession(rawId: string, config: AppConfig): Session | undefined {
    const hash = tokenHash(rawId);
    const row = this.raw
      .prepare(
        `SELECT s.encrypted_tokens, s.csrf_token, s.expires_at, a.*
        FROM sessions s JOIN analysts a ON a.id = s.analyst_id WHERE s.id_hash = ?`,
      )
      .get(hash) as Record<string, unknown> | undefined;
    if (!row || Number(row.expires_at) <= Date.now()) {
      this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
      return undefined;
    }
    const user = this.mapAnalyst(row);
    if (!user) return undefined;
    try {
      return {
        user,
        tokens: decryptJson(
          String(row.encrypted_tokens),
          config.sessionEncryptionKey,
        ) as OidcTokens,
        csrfToken: String(row.csrf_token),
        expiresAt: Number(row.expires_at),
      };
    } catch {
      this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash);
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

  evaluate(result: CompiledQuery, cardinality: CompiledQuery): QueryEvaluation {
    return this.raw.transaction(() => {
      const rows = this.raw
        .prepare(result.sql)
        .all(...result.bindings) as Array<
        Record<string, string | number | null>
      >;
      const groups = this.raw
        .prepare(cardinality.sql)
        .all(...cardinality.bindings) as Array<{ groupSize: number }>;
      const sizes = groups.map((group) => Number(group.groupSize));
      return {
        rows,
        matchingCount: sizes.reduce((total, size) => total + size, 0),
        minimumGroupSize: sizes.length > 0 ? Math.min(...sizes) : 0,
      };
    })();
  }

  storeReadyExport(value: {
    id: string;
    ownerId: string;
    plan: QueryPlan;
    downloadRef: string;
    filePath: string;
    rowCount: number;
  }): ExportSummary {
    const now = Date.now();
    this.raw
      .prepare(
        `INSERT INTO exports
        (id, owner_id, purpose, plan_json, download_hash, plan_digest, file_path,
         state, row_count, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
      )
      .run(
        value.id,
        value.ownerId,
        value.plan.purpose,
        JSON.stringify(value.plan),
        tokenHash(value.downloadRef),
        digestJson(value.plan),
        value.filePath,
        value.rowCount,
        now,
        now + 600_000,
      );
    const stored = this.getExportById(value.id);
    if (!stored) throw new Error("The export metadata was not persisted");
    return this.toSummary(stored);
  }

  getExportById(id: string): ExportRecord | undefined {
    return this.applyExpiry(
      this.mapExport(
        this.raw.prepare("SELECT * FROM exports WHERE id = ?").get(id),
      ),
    );
  }

  getExportByReference(downloadRef: string): ExportRecord | undefined {
    return this.applyExpiry(
      this.mapExport(
        this.raw
          .prepare("SELECT * FROM exports WHERE download_hash = ?")
          .get(tokenHash(downloadRef)),
      ),
    );
  }

  referencedExportFiles(): Set<string> {
    const rows = this.raw
      .prepare("SELECT file_path FROM exports WHERE file_path IS NOT NULL")
      .all() as Array<{ file_path: string }>;
    return new Set(rows.map((row) => row.file_path));
  }

  revokeExport(id: string): ExportSummary | undefined {
    const current = this.getExportById(id);
    if (!current) return undefined;
    if (current.state === "expired" || current.state === "revoked")
      return this.toSummary(current);
    this.raw
      .prepare(
        "UPDATE exports SET state = 'revoked', file_path = NULL WHERE id = ? AND state = 'ready'",
      )
      .run(id);
    if (current.filePath) rmSync(current.filePath, { force: true });
    const revoked = this.getExportById(id);
    return revoked ? this.toSummary(revoked) : undefined;
  }

  forceExpireExport(id: string): void {
    this.raw
      .prepare("UPDATE exports SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, id);
  }

  private applyExpiry(
    value: ExportRecord | undefined,
  ): ExportRecord | undefined {
    if (
      !value ||
      value.state === "expired" ||
      value.state === "revoked" ||
      Date.parse(value.expiresAt) > Date.now()
    )
      return value;
    this.raw
      .prepare(
        "UPDATE exports SET state = 'expired', file_path = NULL WHERE id = ? AND state = 'ready'",
      )
      .run(value.id);
    if (value.filePath) rmSync(value.filePath, { force: true });
    return { ...value, state: "expired", filePath: null };
  }

  private mapExport(value: unknown): ExportRecord | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      purpose: String(row.purpose) as Purpose,
      plan: JSON.parse(String(row.plan_json)) as QueryPlan,
      planDigest: String(row.plan_digest),
      downloadHash: String(row.download_hash),
      filePath: typeof row.file_path === "string" ? row.file_path : null,
      state: String(row.state) as ExportState,
      rowCount: Number(row.row_count),
      createdAt: new Date(Number(row.created_at)).toISOString(),
      expiresAt: new Date(Number(row.expires_at)).toISOString(),
    };
  }

  private toSummary(value: ExportRecord): ExportSummary {
    return {
      id: value.id,
      ownerId: value.ownerId,
      purpose: value.purpose,
      state: value.state,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      rowCount: value.rowCount,
    };
  }
}
