import Sqlite from "better-sqlite3";
import { ACCOUNTS } from "../../shared/rules.ts";
import type { Config } from "../config/environment.ts";
import { encrypt, hash, randomToken } from "./crypto.ts";

export type User = Readonly<{ id: string; name: string }>;
export type LoginTransaction = Readonly<{
  id: string;
  state: string;
  nonce: string;
  verifier: string;
}>;
export type Session = Readonly<{
  idHash: string;
  user: User;
  csrfToken: string;
  expiresAt: number;
}>;

/** Credentials stay in their own private store, outside public game projections. */
export class AuthStore {
  private readonly raw: Sqlite.Database;
  private readonly key: Buffer;
  private readonly clock: () => number;
  constructor(
    filename: string,
    config: Pick<Config, "issuer" | "sessionEncryptionKey">,
    clock = Date.now,
  ) {
    this.clock = clock;
    this.key = config.sessionEncryptionKey;
    this.raw = new Sqlite(filename);
    try {
      this.raw.pragma("journal_mode = WAL");
      this.raw.pragma("foreign_keys = ON");
      this.raw.pragma("busy_timeout = 5000");
      this.raw.exec(`
        CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_transactions (
          id_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL,
          verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, encrypted_token TEXT NOT NULL,
          csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
      `);
      const prior = this.raw
        .prepare("SELECT value FROM metadata WHERE name = 'issuer'")
        .get() as { value: string } | undefined;
      if (prior && prior.value !== config.issuer)
        throw new Error(
          "P14 sessions belong to another issuer. Stop P14 and run pnpm reset before changing its issuer.",
        );
      this.raw
        .prepare(
          "INSERT OR IGNORE INTO metadata(name, value) VALUES ('issuer', ?)",
        )
        .run(config.issuer);
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
  findUser(subject: string): User | undefined {
    return ACCOUNTS.find((user) => user.id === subject);
  }

  createLoginTransaction(): LoginTransaction {
    const transaction = {
      id: randomToken(),
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
    };
    this.raw
      .prepare("DELETE FROM login_transactions WHERE expires_at <= ?")
      .run(this.clock());
    this.raw
      .prepare("INSERT INTO login_transactions VALUES (?, ?, ?, ?, ?)")
      .run(
        hash(transaction.id),
        transaction.state,
        transaction.nonce,
        transaction.verifier,
        this.clock() + 120_000,
      );
    return transaction;
  }

  consumeLoginTransaction(
    id: string,
  ): Omit<LoginTransaction, "id"> | undefined {
    return this.raw.transaction(() => {
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM login_transactions WHERE id_hash = ?",
        )
        .get(hash(id)) as
        | (Omit<LoginTransaction, "id"> & { expires_at: number })
        | undefined;
      this.raw
        .prepare("DELETE FROM login_transactions WHERE id_hash = ?")
        .run(hash(id));
      if (!row || row.expires_at <= this.clock()) return undefined;
      return { state: row.state, nonce: row.nonce, verifier: row.verifier };
    })();
  }

  createSession(
    userId: string,
    accessToken: string,
    expiresAt: number,
  ): { id: string; csrfToken: string } {
    if (
      !this.findUser(userId) ||
      !accessToken ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.clock()
    )
      throw new Error("Invalid bounded session");
    const id = randomToken();
    const csrfToken = randomToken();
    this.raw
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(this.clock());
    this.raw
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)")
      .run(
        hash(id),
        userId,
        encrypt(accessToken, this.key),
        csrfToken,
        Math.min(expiresAt, this.clock() + 30 * 60_000),
      );
    return { id, csrfToken };
  }

  getSession(id: string): Session | undefined {
    return this.getSessionByHash(hash(id));
  }
  getSessionByHash(idHash: string): Session | undefined {
    const row = this.raw
      .prepare(
        "SELECT user_id, csrf_token, expires_at FROM sessions WHERE id_hash = ? AND expires_at > ?",
      )
      .get(idHash, this.clock()) as
      | { user_id: string; csrf_token: string; expires_at: number }
      | undefined;
    const user = row && this.findUser(row.user_id);
    return row && user
      ? { idHash, user, csrfToken: row.csrf_token, expiresAt: row.expires_at }
      : undefined;
  }
  deleteSession(id: string): void {
    this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash(id));
  }
}
