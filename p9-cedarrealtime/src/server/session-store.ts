import type Database from "better-sqlite3";
import type { AppConfig } from "./config.ts";
import { limits } from "./config.ts";
import { decryptJson, encryptJson, randomToken, tokenHash } from "./crypto.ts";
import type { Session, User } from "./models.ts";
import type { OidcTokens, OidcTransaction } from "./oidc.ts";

type Row = Record<string, unknown>;
type RevocationListener = (sessionHash: string) => void;

export class SessionStore {
  readonly #database: Database.Database;
  readonly #revocationListeners = new Set<RevocationListener>();

  constructor(database: Database.Database) {
    this.#database = database;
  }

  onRevoked(listener: RevocationListener): () => void {
    this.#revocationListeners.add(listener);
    return () => this.#revocationListeners.delete(listener);
  }

  createTransaction(
    value: OidcTransaction & { rawId: string; expiresAt: number },
  ): void {
    this.#database
      .prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
      .run(Date.now());
    this.#database
      .prepare(
        `INSERT INTO oidc_transactions
         (id_hash, state, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        tokenHash(value.rawId),
        value.state,
        value.nonce,
        value.verifier,
        value.expiresAt,
      );
  }

  consumeTransaction(rawId: string): OidcTransaction | undefined {
    return this.#database.transaction(() => {
      const idHash = tokenHash(rawId);
      const row = this.#database
        .prepare("SELECT * FROM oidc_transactions WHERE id_hash = ?")
        .get(idHash) as Row | undefined;
      this.#database
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
  ): { rawId: string; csrfToken: string; expiresAt: number } {
    const rawId = randomToken();
    const csrfToken = randomToken();
    const expiresAt = Date.now() + limits.sessionMs;
    this.#database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    this.#database
      .prepare(
        `INSERT INTO sessions
         (id_hash, user_id, encrypted_tokens, csrf_token, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        tokenHash(rawId),
        userId,
        encryptJson(tokens, config.sessionEncryptionKey),
        csrfToken,
        expiresAt,
      );
    return { rawId, csrfToken, expiresAt };
  }

  getSession(rawId: string, config: AppConfig): Session | undefined {
    return this.getSessionByHash(tokenHash(rawId), config);
  }

  getSessionByHash(idHash: string, config: AppConfig): Session | undefined {
    const row = this.#database
      .prepare(
        `SELECT s.id_hash, s.encrypted_tokens, s.csrf_token, s.expires_at,
                s.revoked_at, u.id, u.issuer, u.subject, u.name, u.tenant_id
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ?`,
      )
      .get(idHash) as Row | undefined;
    if (
      !row ||
      row.revoked_at !== null ||
      Number(row.expires_at) <= Date.now()
    ) {
      if (row) {
        this.#database
          .prepare("DELETE FROM sessions WHERE id_hash = ?")
          .run(idHash);
        this.notify(idHash);
      }
      return undefined;
    }
    try {
      const tokens = decryptJson<OidcTokens>(
        String(row.encrypted_tokens),
        config.sessionEncryptionKey,
      );
      if (!tokens.accessToken || !tokens.refreshToken || !tokens.idToken) {
        throw new Error("Invalid token set");
      }
      const user: User = {
        id: String(row.id),
        issuer: String(row.issuer),
        subject: String(row.subject),
        name: String(row.name),
        tenantId: String(row.tenant_id),
      };
      return {
        idHash,
        user,
        tokens,
        csrfToken: String(row.csrf_token),
        expiresAt: Number(row.expires_at),
      };
    } catch {
      this.#database
        .prepare("DELETE FROM sessions WHERE id_hash = ?")
        .run(idHash);
      this.notify(idHash);
      return undefined;
    }
  }

  updateTokens(rawId: string, tokens: OidcTokens, config: AppConfig): void {
    this.#database
      .prepare(
        "UPDATE sessions SET encrypted_tokens = ? WHERE id_hash = ? AND revoked_at IS NULL",
      )
      .run(encryptJson(tokens, config.sessionEncryptionKey), tokenHash(rawId));
  }

  revokeSession(rawId: string): void {
    const idHash = tokenHash(rawId);
    this.#database
      .prepare(
        "UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), idHash);
    this.notify(idHash);
  }

  createTicket(sessionHash: string): { ticket: string; expiresAt: number } {
    const ticket = randomToken();
    const expiresAt = Date.now() + limits.ticketMs;
    this.#database
      .prepare("DELETE FROM connection_tickets WHERE expires_at <= ?")
      .run(Date.now());
    this.#database
      .prepare(
        `INSERT INTO connection_tickets
         (ticket_hash, session_hash, expires_at, consumed_at)
         VALUES (?, ?, ?, NULL)`,
      )
      .run(tokenHash(ticket), sessionHash, expiresAt);
    return { ticket, expiresAt };
  }

  consumeTicket(ticket: string, config: AppConfig): Session | undefined {
    const sessionHash = this.#database.transaction(() => {
      const hash = tokenHash(ticket);
      const row = this.#database
        .prepare("SELECT * FROM connection_tickets WHERE ticket_hash = ?")
        .get(hash) as Row | undefined;
      if (
        !row ||
        row.consumed_at !== null ||
        Number(row.expires_at) <= Date.now()
      ) {
        return undefined;
      }
      const changed = this.#database
        .prepare(
          `UPDATE connection_tickets SET consumed_at = ?
           WHERE ticket_hash = ? AND consumed_at IS NULL`,
        )
        .run(Date.now(), hash);
      return changed.changes === 1 ? String(row.session_hash) : undefined;
    })();
    return sessionHash ? this.getSessionByHash(sessionHash, config) : undefined;
  }

  private notify(sessionHash: string): void {
    for (const listener of this.#revocationListeners) listener(sessionHash);
  }
}
