import type Database from "better-sqlite3";
import type { AppConfig } from "./config.ts";
import { limits } from "./config.ts";
import { decryptJson, encryptJson, randomToken, tokenHash } from "./crypto.ts";
import type { Session, User } from "./models.ts";
import type { OidcTokens, OidcTransaction } from "./oidc.ts";

export class SessionStore {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  findUser(issuer: string, subject: string): User | undefined {
    return this.mapUser(
      this.database
        .prepare("SELECT * FROM users WHERE issuer = ? AND subject = ?")
        .get(issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return this.mapUser(
      this.database.prepare("SELECT * FROM users WHERE id = ?").get(id),
    );
  }

  createTransaction(
    values: OidcTransaction & { rawId: string; expiresAt: number },
  ): void {
    this.database
      .prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
      .run(Date.now());
    this.database
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

  consumeTransaction(rawId: string): OidcTransaction | undefined {
    return this.database.transaction(() => {
      const idHash = tokenHash(rawId);
      const row = this.database
        .prepare("SELECT * FROM oidc_transactions WHERE id_hash = ?")
        .get(idHash) as Record<string, unknown> | undefined;
      this.database
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(idHash);
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
    this.database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    this.database
      .prepare(
        "INSERT INTO sessions (id_hash, user_id, encrypted_tokens, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        tokenHash(rawId),
        userId,
        encryptJson(tokens, config.sessionEncryptionKey),
        csrfToken,
        Date.now() + limits.sessionMs,
      );
    return { rawId, csrfToken };
  }

  getSession(rawId: string, config: AppConfig): Session | undefined {
    const idHash = tokenHash(rawId);
    const row = this.database
      .prepare(`SELECT s.encrypted_tokens, s.csrf_token, s.expires_at, u.*
        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`)
      .get(idHash) as Record<string, unknown> | undefined;
    if (!row || Number(row.expires_at) <= Date.now()) {
      this.database
        .prepare("DELETE FROM sessions WHERE id_hash = ?")
        .run(idHash);
      return undefined;
    }
    const user = this.mapUser(row);
    if (!user) return undefined;
    try {
      const tokens = decryptJson<OidcTokens>(
        String(row.encrypted_tokens),
        config.sessionEncryptionKey,
      );
      if (!tokens.accessToken || !tokens.refreshToken || !tokens.idToken) {
        throw new Error("invalid token set");
      }
      return {
        user,
        tokens,
        csrfToken: String(row.csrf_token),
        expiresAt: Number(row.expires_at),
      };
    } catch {
      this.database
        .prepare("DELETE FROM sessions WHERE id_hash = ?")
        .run(idHash);
      return undefined;
    }
  }

  updateSessionTokens(
    rawId: string,
    tokens: OidcTokens,
    config: AppConfig,
  ): void {
    this.database
      .prepare("UPDATE sessions SET encrypted_tokens = ? WHERE id_hash = ?")
      .run(encryptJson(tokens, config.sessionEncryptionKey), tokenHash(rawId));
  }

  deleteSession(rawId: string): void {
    this.database
      .prepare("DELETE FROM sessions WHERE id_hash = ?")
      .run(tokenHash(rawId));
  }

  private mapUser(value: unknown): User | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      issuer: String(row.issuer),
      subject: String(row.subject),
      name: String(row.name),
      homeWorkspaceId: String(row.home_workspace_id),
      workspaceRole: String(row.workspace_role) as User["workspaceRole"],
    };
  }
}
