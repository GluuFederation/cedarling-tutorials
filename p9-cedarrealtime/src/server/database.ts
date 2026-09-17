import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { limits } from "./config.ts";
import { DomainError } from "./errors.ts";
import type { Membership, Message, Room, User } from "./models.ts";

type Row = Record<string, unknown>;
type CommandResult<T> = Readonly<{ value: T; duplicate: boolean }>;

type CommandKind = "publish" | "remove" | "delete";
type CommandRequest =
  | Readonly<{ roomId: string; content: string }>
  | Readonly<{
      roomId: string;
      userId: string;
      expectedVersion: number;
    }>
  | Readonly<{
      roomId: string;
      messageId: string;
      expectedVersion: number;
    }>;

function commandRequestHash(kind: CommandKind, input: CommandRequest): string {
  const parts: unknown[] = [kind, input.roomId];
  if (kind === "publish" && "content" in input) parts.push(input.content);
  else if (kind === "remove" && "userId" in input)
    parts.push(input.userId, input.expectedVersion);
  else if (kind === "delete" && "messageId" in input)
    parts.push(input.messageId, input.expectedVersion);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function user(row: unknown): User | undefined {
  const value = row as Row | undefined;
  if (!value) return undefined;
  return {
    id: String(value.id),
    issuer: String(value.issuer),
    subject: String(value.subject),
    name: String(value.name),
    tenantId: String(value.tenant_id),
  };
}

function room(row: unknown): Room | undefined {
  const value = row as Row | undefined;
  if (!value) return undefined;
  return {
    id: String(value.id),
    tenantId: String(value.tenant_id),
    name: String(value.name),
    version: Number(value.version),
    nextSequence: Number(value.next_sequence),
  };
}

function membership(row: unknown): Membership | undefined {
  const value = row as Row | undefined;
  if (!value) return undefined;
  return {
    roomId: String(value.room_id),
    userId: String(value.user_id),
    role: String(value.role) as Membership["role"],
    active: Number(value.active) === 1,
    version: Number(value.version),
    ...(value.revoked_at == null
      ? {}
      : { revokedAt: Number(value.revoked_at) }),
  };
}

function message(row: unknown): Message | undefined {
  const value = row as Row | undefined;
  if (!value) return undefined;
  const deleted = Number(value.deleted) === 1;
  return {
    id: String(value.id),
    roomId: String(value.room_id),
    authorId: String(value.author_id),
    authorName: String(value.author_name),
    content: deleted ? null : String(value.content),
    sequence: Number(value.sequence),
    version: Number(value.version),
    deleted,
    createdAt: Number(value.created_at),
  };
}

export function databasePath(dataRoot: string): string {
  return path.join(dataRoot, "p9.sqlite");
}

export class ChatRepository {
  readonly connection: Database.Database;

  constructor(connection: Database.Database) {
    this.connection = connection;
  }

  findUser(issuer: string, subject: string): User | undefined {
    return user(
      this.connection
        .prepare("SELECT * FROM users WHERE issuer = ? AND subject = ?")
        .get(issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return user(
      this.connection.prepare("SELECT * FROM users WHERE id = ?").get(id),
    );
  }

  room(id: string): Room | undefined {
    return room(
      this.connection.prepare("SELECT * FROM rooms WHERE id = ?").get(id),
    );
  }

  roomsForUser(userId: string): Room[] {
    return (
      this.connection
        .prepare(
          `SELECT r.* FROM rooms r
           JOIN memberships m ON m.room_id = r.id
           WHERE m.user_id = ? AND m.active = 1
           ORDER BY r.tenant_id, r.name`,
        )
        .all(userId) as Row[]
    ).flatMap((value) => {
      const mapped = room(value);
      return mapped ? [mapped] : [];
    });
  }

  hasCommand(
    userId: string,
    commandId: string,
    kind: CommandKind,
    input: CommandRequest,
  ): boolean {
    return (
      this.command(userId, commandId, kind, commandRequestHash(kind, input)) !==
      undefined
    );
  }

  membership(roomId: string, userId: string): Membership | undefined {
    return membership(
      this.connection
        .prepare("SELECT * FROM memberships WHERE room_id = ? AND user_id = ?")
        .get(roomId, userId),
    );
  }

  members(roomId: string): Array<Membership & { name: string }> {
    return (
      this.connection
        .prepare(
          `SELECT m.*, u.name FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.room_id = ? ORDER BY m.active DESC, u.name`,
        )
        .all(roomId) as Row[]
    ).flatMap((value) => {
      const mapped = membership(value);
      return mapped ? [{ ...mapped, name: String(value.name) }] : [];
    });
  }

  messagePageAfter(
    roomId: string,
    sequence: number,
  ): Readonly<{ messages: Message[]; hasMore: boolean }> {
    const rows = this.connection
      .prepare(
        `SELECT m.*, u.name AS author_name FROM messages m
         JOIN users u ON u.id = m.author_id
         WHERE m.room_id = ? AND m.sequence > ?
         ORDER BY m.sequence ASC LIMIT ?`,
      )
      .all(roomId, sequence, limits.history + 1) as Row[];
    const messages = rows.slice(0, limits.history).flatMap((value) => {
      const mapped = message(value);
      return mapped ? [mapped] : [];
    });
    return { messages, hasMore: rows.length > limits.history };
  }

  message(id: string): Message | undefined {
    return message(
      this.connection
        .prepare(
          `SELECT m.*, u.name AS author_name FROM messages m
           JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
        )
        .get(id),
    );
  }

  publish(
    input: Readonly<{
      userId: string;
      roomId: string;
      commandId: string;
      content: string;
      messageId: string;
      now: number;
    }>,
  ): CommandResult<Message> {
    return this.connection.transaction(() => {
      const requestHash = commandRequestHash("publish", input);
      const previous = this.command<Message>(
        input.userId,
        input.commandId,
        "publish",
        requestHash,
      );
      if (previous) return { value: previous, duplicate: true };
      const currentRoom = this.room(input.roomId);
      if (!currentRoom) throw new DomainError("room_not_found", 404);
      this.connection
        .prepare(
          "UPDATE rooms SET next_sequence = next_sequence + 1, version = version + 1 WHERE id = ? AND next_sequence = ?",
        )
        .run(input.roomId, currentRoom.nextSequence);
      this.connection
        .prepare(
          `INSERT INTO messages
           (id, room_id, author_id, content, sequence, version, deleted, created_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
        )
        .run(
          input.messageId,
          input.roomId,
          input.userId,
          input.content,
          currentRoom.nextSequence,
          input.now,
        );
      const created = this.message(input.messageId);
      if (!created) throw new Error("Committed message could not be reloaded");
      this.storeCommand(
        input.userId,
        input.commandId,
        "publish",
        created,
        requestHash,
        input.now,
      );
      return { value: created, duplicate: false };
    })();
  }

  removeMember(
    input: Readonly<{
      actorId: string;
      roomId: string;
      userId: string;
      commandId: string;
      expectedVersion: number;
      now: number;
    }>,
  ): CommandResult<Membership> {
    return this.connection.transaction(() => {
      const requestHash = commandRequestHash("remove", input);
      const previous = this.command<Membership>(
        input.actorId,
        input.commandId,
        "remove",
        requestHash,
      );
      if (previous) return { value: previous, duplicate: true };
      if (input.actorId === input.userId) {
        throw new DomainError("self_removal_not_supported", 409);
      }
      const target = this.membership(input.roomId, input.userId);
      if (!target?.active) {
        throw new DomainError("membership_not_found", 404);
      }
      if (target.version !== input.expectedVersion) {
        throw new DomainError("stale_membership_version", 409);
      }
      const changed = this.connection
        .prepare(
          `UPDATE memberships SET active = 0, version = version + 1, revoked_at = ?
           WHERE room_id = ? AND user_id = ? AND active = 1 AND version = ?`,
        )
        .run(input.now, input.roomId, input.userId, input.expectedVersion);
      if (changed.changes !== 1) {
        throw new DomainError("stale_membership_version", 409);
      }
      const removed = this.membership(input.roomId, input.userId);
      if (!removed) throw new Error("Removed membership could not be reloaded");
      this.storeCommand(
        input.actorId,
        input.commandId,
        "remove",
        removed,
        requestHash,
        input.now,
      );
      return { value: removed, duplicate: false };
    })();
  }

  deleteMessage(
    input: Readonly<{
      actorId: string;
      roomId: string;
      messageId: string;
      commandId: string;
      expectedVersion: number;
      now: number;
    }>,
  ): CommandResult<Message> {
    return this.connection.transaction(() => {
      const requestHash = commandRequestHash("delete", input);
      const previous = this.command<Message>(
        input.actorId,
        input.commandId,
        "delete",
        requestHash,
      );
      if (previous) return { value: previous, duplicate: true };
      const target = this.message(input.messageId);
      if (!target || target.roomId !== input.roomId) {
        throw new DomainError("message_not_found", 404);
      }
      if (target.deleted) throw new DomainError("message_already_deleted", 409);
      if (target.version !== input.expectedVersion) {
        throw new DomainError("stale_message_version", 409);
      }
      const changed = this.connection
        .prepare(
          `UPDATE messages SET deleted = 1, version = version + 1
           WHERE id = ? AND room_id = ? AND deleted = 0 AND version = ?`,
        )
        .run(input.messageId, input.roomId, input.expectedVersion);
      if (changed.changes !== 1) {
        throw new DomainError("stale_message_version", 409);
      }
      const deleted = this.message(input.messageId);
      if (!deleted) throw new Error("Deleted message could not be reloaded");
      this.storeCommand(
        input.actorId,
        input.commandId,
        "delete",
        deleted,
        requestHash,
        input.now,
      );
      return { value: deleted, duplicate: false };
    })();
  }

  private command<T>(
    userId: string,
    commandId: string,
    kind: CommandKind,
    requestHash: string,
  ): T | undefined {
    const row = this.connection
      .prepare(
        "SELECT kind, request_hash, result_json FROM processed_commands WHERE user_id = ? AND command_id = ?",
      )
      .get(userId, commandId) as Row | undefined;
    if (!row) return undefined;
    if (row.kind !== kind || row.request_hash !== requestHash) {
      throw new DomainError("command_id_reused", 409);
    }
    return JSON.parse(String(row.result_json)) as T;
  }

  private storeCommand(
    userId: string,
    commandId: string,
    kind: CommandKind,
    result: unknown,
    requestHash: string,
    now: number,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO processed_commands
         (user_id, command_id, kind, request_hash, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, commandId, kind, requestHash, JSON.stringify(result), now);
  }
}

export class AppDatabase {
  readonly connection: Database.Database;
  readonly chat: ChatRepository;

  constructor(file: string, issuer: string) {
    const root = path.dirname(file);
    if (existsSync(root)) {
      const stat = lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("P9 data root must be a real directory");
      }
    } else {
      mkdirSync(root, { recursive: true, mode: 0o700 });
    }
    this.connection = new Database(file);
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("busy_timeout = 5000");
    this.migrate();
    this.seed(issuer);
    this.chat = new ChatRepository(this.connection);
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        name TEXT NOT NULL,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        UNIQUE (issuer, subject)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        next_sequence INTEGER NOT NULL CHECK (next_sequence >= 1),
        UNIQUE (tenant_id, name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memberships (
        room_id TEXT NOT NULL REFERENCES rooms(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('member', 'moderator')),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        version INTEGER NOT NULL CHECK (version >= 1),
        revoked_at INTEGER,
        PRIMARY KEY (room_id, user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        author_id TEXT NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        version INTEGER NOT NULL CHECK (version >= 1),
        deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
        created_at INTEGER NOT NULL,
        UNIQUE (room_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS processed_commands (
        user_id TEXT NOT NULL REFERENCES users(id),
        command_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('publish', 'remove', 'delete')),
        request_hash TEXT,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, command_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS oidc_transactions (
        id_hash TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        nonce TEXT NOT NULL,
        verifier TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        encrypted_tokens TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS connection_tickets (
        ticket_hash TEXT PRIMARY KEY,
        session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      ) STRICT;
    `);
    const commandColumns = this.connection.pragma(
      "table_info(processed_commands)",
    ) as Array<{ name: string }>;
    if (!commandColumns.some((column) => column.name === "request_hash")) {
      this.connection.exec(
        "ALTER TABLE processed_commands ADD COLUMN request_hash TEXT",
      );
    }
  }

  private seed(issuer: string): void {
    const insertTenant = this.connection.prepare(
      "INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)",
    );
    insertTenant.run("tenant-a", "Tenant A");
    insertTenant.run("tenant-b", "Tenant B");
    const insertUser = this.connection.prepare(
      `INSERT INTO users (id, issuer, subject, name, tenant_id)
       VALUES (?, ?, ?, ?, 'tenant-a')
       ON CONFLICT(id) DO UPDATE SET issuer = excluded.issuer,
         subject = excluded.subject, name = excluded.name`,
    );
    insertUser.run("user-mei", issuer, "mei", "Mei");
    insertUser.run("user-kwame", issuer, "kwame", "Kwame");
    insertUser.run("user-yuki", issuer, "yuki", "Yuki");
    const insertRoom = this.connection.prepare(
      `INSERT OR IGNORE INTO rooms
       (id, tenant_id, name, version, next_sequence) VALUES (?, ?, ?, 1, 1)`,
    );
    insertRoom.run("room-a-general", "tenant-a", "general");
    insertRoom.run("room-a-restricted", "tenant-a", "restricted");
    insertRoom.run("room-b-general", "tenant-b", "general");
    const insertMembership = this.connection.prepare(
      `INSERT OR IGNORE INTO memberships
       (room_id, user_id, role, active, version, revoked_at)
       VALUES (?, ?, ?, 1, 1, NULL)`,
    );
    insertMembership.run("room-a-general", "user-mei", "member");
    insertMembership.run("room-a-general", "user-kwame", "moderator");
    insertMembership.run("room-a-general", "user-yuki", "member");
    insertMembership.run("room-a-restricted", "user-kwame", "moderator");
  }
}
