import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeDatabase } from "./database-fixtures.ts";
import { ResourceRepository } from "./resource-repository.ts";
import { SessionStore } from "./session-store.ts";
import type { SafeStorage } from "./storage.ts";

export { DomainError } from "./errors.ts";
export type { Resource, Session, ShareRole, User } from "./models.ts";

export class AppDatabase {
  readonly resources: ResourceRepository;
  readonly sessions: SessionStore;
  private readonly raw: Database.Database;

  constructor(filename: string, issuer: string, storage?: SafeStorage) {
    this.raw = new Database(filename);
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("journal_mode = WAL");
    initializeDatabase(this.raw, issuer, storage);
    this.resources = new ResourceRepository(this.raw);
    this.sessions = new SessionStore(this.raw);
  }

  close(): void {
    this.raw.close();
  }
}

export function databasePath(dataRoot: string): string {
  const requestedRoot = path.resolve(dataRoot);
  const rootStat = lstatSync(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("database_path_rejected");
  }
  const canonicalRoot = realpathSync(requestedRoot);
  if (canonicalRoot !== requestedRoot) {
    throw new Error("database_path_rejected");
  }
  const filename = path.join(canonicalRoot, "p8.sqlite");
  if (existsSync(filename)) {
    const fileStat = lstatSync(filename);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error("database_path_rejected");
    }
    const canonicalFile = realpathSync(filename);
    if (path.dirname(canonicalFile) !== canonicalRoot) {
      throw new Error("database_path_rejected");
    }
  }
  return filename;
}
