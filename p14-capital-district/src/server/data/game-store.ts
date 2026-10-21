import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import SQLite from "better-sqlite3";
import type { CommandReceipt, MatchSnapshot } from "../../shared/contracts.ts";

export interface SavedReceipt {
  fingerprint: string;
  receipt: CommandReceipt;
}

/** Match snapshots and command receipts commit together; no transaction awaits IO. */
export class GameStore {
  private readonly db: SQLite.Database;

  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new SQLite(filename);
    try {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS game_matches (id TEXT PRIMARY KEY, version INTEGER NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS game_receipts (actor_id TEXT NOT NULL, command_key TEXT NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(actor_id, command_key));
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  list(): MatchSnapshot[] {
    return (
      this.db
        .prepare("SELECT snapshot FROM game_matches ORDER BY rowid DESC")
        .all() as { snapshot: string }[]
    ).map((row) => JSON.parse(row.snapshot) as MatchSnapshot);
  }

  get(id: string): MatchSnapshot | undefined {
    const row = this.db
      .prepare("SELECT snapshot FROM game_matches WHERE id = ?")
      .get(id) as { snapshot: string } | undefined;
    return row ? (JSON.parse(row.snapshot) as MatchSnapshot) : undefined;
  }

  receipt(actorId: string, key: string): SavedReceipt | undefined {
    const row = this.db
      .prepare(
        "SELECT fingerprint, receipt FROM game_receipts WHERE actor_id = ? AND command_key = ?",
      )
      .get(actorId, key) as
      | { fingerprint: string; receipt: string }
      | undefined;
    return row
      ? {
          fingerprint: row.fingerprint,
          receipt: JSON.parse(row.receipt) as CommandReceipt,
        }
      : undefined;
  }

  commit(
    match: MatchSnapshot,
    expectedVersion: number | null,
    key: string,
    fingerprint: string,
    receipt: CommandReceipt,
  ): boolean {
    return this.db
      .transaction(() => {
        if (this.receipt(receipt.actorId, key)) return false;
        if (expectedVersion === null) {
          if (this.get(match.id)) return false;
          this.db
            .prepare(
              "INSERT INTO game_matches(id, version, snapshot) VALUES (?, ?, ?)",
            )
            .run(match.id, match.version, JSON.stringify(match));
        } else {
          const result = this.db
            .prepare(
              "UPDATE game_matches SET version = ?, snapshot = ? WHERE id = ? AND version = ?",
            )
            .run(
              match.version,
              JSON.stringify(match),
              match.id,
              expectedVersion,
            );
          if (result.changes !== 1) return false;
        }
        this.db
          .prepare(
            "INSERT INTO game_receipts(actor_id, command_key, fingerprint, receipt) VALUES (?, ?, ?, ?)",
          )
          .run(receipt.actorId, key, fingerprint, JSON.stringify(receipt));
        return true;
      })
      .immediate();
  }

  close(): void {
    this.db.close();
  }
}
