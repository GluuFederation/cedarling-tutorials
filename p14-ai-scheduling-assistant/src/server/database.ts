import { randomUUID } from "node:crypto";
import Sqlite from "better-sqlite3";
import { tutorialUsers } from "../shared/catalog.ts";
import type { ToolName } from "../shared/tool-catalog.ts";
import type {
  ExecutionResult,
  Meeting,
  Room,
  ToolArguments,
  User,
} from "../shared/types.ts";
import type { Config } from "./config.ts";
import {
  decryptJson,
  digest,
  encryptJson,
  hash,
  randomToken,
} from "./crypto.ts";
import { AppError } from "./errors.ts";

export type LoginTransaction = Readonly<{
  id: string;
  state: string;
  nonce: string;
  verifier: string;
}>;

export type Session = Readonly<{
  idHash: string;
  user: User;
  accessToken: string;
  csrfToken: string;
}>;

export type StoredProposal = Readonly<{
  idHash: string;
  tool: ToolName;
  arguments: ToolArguments;
  digest: string;
  expiresAt: number;
  status: "pending" | "consumed";
  version: number;
  result?: ExecutionResult;
}>;

type MeetingRow = {
  id: string;
  title: string;
  organizer_id: string;
  organizer_name: string;
  room_id: string;
  room_name: string;
  access_class: "employee" | "visitor";
  capacity: number;
  classification: "internal" | "confidential" | "external";
  start_at: string;
  end_at: string;
  status: "scheduled" | "cancelled";
  version: number;
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  access_class TEXT NOT NULL CHECK (access_class IN ('employee', 'visitor')),
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  classification TEXT NOT NULL CHECK (classification IN ('internal', 'confidential', 'external')),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
  version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES users(id),
  delegate_id TEXT NOT NULL REFERENCES users(id),
  meeting_id TEXT NOT NULL REFERENCES meetings(id),
  operation TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL, tool TEXT NOT NULL, arguments_json TEXT NOT NULL,
  proposal_digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'consumed')),
  version INTEGER NOT NULL, result_json TEXT
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL,
  verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  encrypted_access_token TEXT NOT NULL, csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meetings_by_time ON meetings(start_at, end_at);
CREATE INDEX IF NOT EXISTS proposals_by_owner ON proposals(user_id, session_hash);
`;

export class AppDatabase {
  private readonly raw: Sqlite.Database;
  private readonly config: Pick<Config, "issuer" | "sessionEncryptionKey">;

  constructor(
    path: string,
    config: Pick<Config, "issuer" | "sessionEncryptionKey">,
  ) {
    this.config = config;
    this.raw = new Sqlite(path);
    this.raw.pragma("journal_mode = WAL");
    this.raw.exec(schema);
    this.seed();
  }

  close(): void {
    this.raw.close();
  }

  reset(): void {
    this.raw.transaction(() => {
      this.raw.exec(`
        DELETE FROM sessions; DELETE FROM oidc_transactions; DELETE FROM proposals;
        DELETE FROM delegations; DELETE FROM meeting_attendees; DELETE FROM meetings;
        DELETE FROM rooms; DELETE FROM users;
      `);
      this.seedRows();
    })();
  }

  private seed(): void {
    const row = this.raw
      .prepare("SELECT COUNT(*) AS count FROM users")
      .get() as { count: number };
    if (row.count === 0) this.seedRows();
  }

  private seedRows(): void {
    const addUser = this.raw.prepare(
      "INSERT INTO users (id, issuer, subject, name, role, kind) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const user of tutorialUsers)
      addUser.run(
        user.id,
        this.config.issuer,
        user.subject,
        user.name,
        user.role,
        user.kind,
      );
    const addRoom = this.raw.prepare(
      "INSERT INTO rooms (id, name, access_class, capacity) VALUES (?, ?, ?, ?)",
    );
    addRoom.run("room-atlas", "Atlas Boardroom", "employee", 10);
    addRoom.run("room-focus", "Focus Room", "employee", 6);
    addRoom.run("room-welcome", "Welcome Room", "visitor", 8);

    const monday = nextMonday();
    this.insertSeedMeeting(
      "meeting-launch",
      "Launch Review",
      "user-dina",
      "room-atlas",
      "internal",
      at(monday, 9),
      at(monday, 10),
      ["user-benoit"],
    );
    this.insertSeedMeeting(
      "meeting-leadership",
      "Leadership Sync",
      "user-dina",
      "room-focus",
      "confidential",
      at(monday, 11),
      at(monday, 12),
      ["user-amara"],
    );
    this.insertSeedMeeting(
      "meeting-vendor",
      "Vendor Onboarding",
      "user-dina",
      "room-welcome",
      "external",
      at(addDays(monday, 1), 14),
      at(addDays(monday, 1), 15),
      ["user-chloe"],
    );
    const addDelegation = this.raw.prepare(
      "INSERT INTO delegations (id, principal_id, delegate_id, meeting_id, operation, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    addDelegation.run(
      "delegation-active",
      "user-dina",
      "user-amara",
      "meeting-launch",
      "meeting.reschedule",
      "active",
      at(addDays(monday, 30), 18),
    );
    addDelegation.run(
      "delegation-revoked",
      "user-dina",
      "user-amara",
      "meeting-leadership",
      "meeting.cancel",
      "revoked",
      at(addDays(monday, 30), 18),
    );
  }

  private insertSeedMeeting(
    id: string,
    title: string,
    organizerId: string,
    roomId: string,
    classification: Meeting["classification"],
    startAt: string,
    endAt: string,
    attendeeIds: readonly string[],
  ): void {
    this.raw
      .prepare(
        "INSERT INTO meetings (id, title, organizer_id, room_id, classification, start_at, end_at, status, version) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', 1)",
      )
      .run(id, title, organizerId, roomId, classification, startAt, endAt);
    const add = this.raw.prepare(
      "INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)",
    );
    for (const attendee of attendeeIds) add.run(id, attendee);
  }

  findUser(subject: string): User | undefined {
    return mapUser(
      this.raw
        .prepare(
          "SELECT id, name, role, kind FROM users WHERE issuer = ? AND subject = ?",
        )
        .get(this.config.issuer, subject),
    );
  }

  findUserById(id: string): User | undefined {
    return mapUser(
      this.raw
        .prepare("SELECT id, name, role, kind FROM users WHERE id = ?")
        .get(id),
    );
  }

  findUsersByName(name: string): readonly User[] {
    return (
      this.raw
        .prepare(
          "SELECT id, name, role, kind FROM users WHERE name = ? ORDER BY id LIMIT 2",
        )
        .all(name) as Record<string, unknown>[]
    ).flatMap((row) => {
      const user = mapUser(row);
      return user ? [user] : [];
    });
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
        hash(transaction.id),
        transaction.state,
        transaction.nonce,
        transaction.verifier,
        now + 120_000,
      );
    return transaction;
  }

  consumeLoginTransaction(
    id: string,
    now = Date.now(),
  ): Omit<LoginTransaction, "id"> | undefined {
    return this.raw.transaction(() => {
      const row = this.raw
        .prepare(
          "SELECT state, nonce, verifier, expires_at FROM oidc_transactions WHERE id_hash = ?",
        )
        .get(hash(id)) as
        | { state: string; nonce: string; verifier: string; expires_at: number }
        | undefined;
      this.raw
        .prepare("DELETE FROM oidc_transactions WHERE id_hash = ?")
        .run(hash(id));
      if (!row || row.expires_at <= now) return undefined;
      return { state: row.state, nonce: row.nonce, verifier: row.verifier };
    })();
  }

  createSession(
    userId: string,
    accessToken: string,
    expiresAt: number,
  ): { id: string; csrfToken: string } {
    const id = randomToken();
    const csrfToken = randomToken();
    this.raw
      .prepare(
        "INSERT INTO sessions (id_hash, user_id, encrypted_access_token, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        hash(id),
        userId,
        encryptJson({ accessToken }, this.config.sessionEncryptionKey),
        csrfToken,
        expiresAt,
      );
    return { id, csrfToken };
  }

  getSession(id: string, now = Date.now()): Session | undefined {
    const row = this.raw
      .prepare(
        `SELECT s.id_hash, s.encrypted_access_token, s.csrf_token,
              u.id, u.name, u.role, u.kind
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ?`,
      )
      .get(hash(id), now) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const tokens = decryptJson<{ accessToken: string }>(
      String(row.encrypted_access_token),
      this.config.sessionEncryptionKey,
    );
    const user = mapUser(row);
    if (!user) return undefined;
    return {
      idHash: String(row.id_hash),
      user,
      accessToken: tokens.accessToken,
      csrfToken: String(row.csrf_token),
    };
  }

  deleteSession(id: string): void {
    this.raw.prepare("DELETE FROM sessions WHERE id_hash = ?").run(hash(id));
  }

  listRooms(): readonly Room[] {
    return (
      this.raw
        .prepare(
          "SELECT id, name, access_class, capacity FROM rooms ORDER BY name",
        )
        .all() as Record<string, unknown>[]
    ).map(mapRoom);
  }

  listMeetings(): readonly Meeting[] {
    return (
      this.raw
        .prepare(meetingQuery("ORDER BY m.start_at, m.id LIMIT 50"))
        .all() as MeetingRow[]
    ).map((row) => this.mapMeeting(row));
  }

  findMeeting(id: string): Meeting | undefined {
    const row = this.raw.prepare(meetingQuery("WHERE m.id = ?")).get(id) as
      | MeetingRow
      | undefined;
    return row ? this.mapMeeting(row) : undefined;
  }

  private mapMeeting(row: MeetingRow): Meeting {
    const attendees = this.raw
      .prepare(
        "SELECT u.id, u.name FROM meeting_attendees a JOIN users u ON u.id = a.user_id WHERE a.meeting_id = ? ORDER BY u.name",
      )
      .all(row.id) as { id: string; name: string }[];
    return {
      id: row.id,
      title: row.title,
      organizerId: row.organizer_id,
      organizerName: row.organizer_name,
      attendeeIds: attendees.map((item) => item.id),
      attendeeNames: attendees.map((item) => item.name),
      room: {
        id: row.room_id,
        name: row.room_name,
        accessClass: row.access_class,
        capacity: row.capacity,
      },
      classification: row.classification,
      startAt: row.start_at,
      endAt: row.end_at,
      status: row.status,
      version: row.version,
    };
  }

  delegationFacts(
    userId: string,
    meetingId: string,
    operation: string,
  ): Readonly<Record<string, unknown>> {
    const row = this.raw
      .prepare(
        "SELECT status, expires_at FROM delegations WHERE delegate_id = ? AND meeting_id = ? AND operation = ?",
      )
      .get(userId, meetingId, operation) as
      | { status: string; expires_at: string }
      | undefined;
    return {
      delegationStatus: row?.status ?? "absent",
      delegationExpired: row ? Date.parse(row.expires_at) <= Date.now() : false,
    };
  }

  suggestedWindow(): { startAt: string; endAt: string } {
    const vendor = this.findMeeting("meeting-vendor");
    const start = vendor
      ? Date.parse(vendor.endAt) + 24 * 60 * 60_000
      : Date.now() + 7 * 24 * 60 * 60_000;
    return {
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 3_600_000).toISOString(),
    };
  }

  createProposal(input: {
    sessionHash: string;
    userId: string;
    tool: ToolName;
    arguments: ToolArguments;
    now?: number;
  }): { id: string; version: number; expiresAt: number } {
    const id = randomToken();
    const now = input.now ?? Date.now();
    const proposalDigest = digest({
      tool: input.tool,
      arguments: input.arguments,
      userId: input.userId,
      sessionHash: input.sessionHash,
    });
    this.raw
      .prepare(
        `INSERT INTO proposals
       (id_hash, user_id, session_hash, tool, arguments_json, proposal_digest, expires_at, status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
      )
      .run(
        hash(id),
        input.userId,
        input.sessionHash,
        input.tool,
        JSON.stringify(input.arguments),
        proposalDigest,
        now + 120_000,
      );
    return { id, version: 1, expiresAt: now + 120_000 };
  }

  getProposal(
    id: string,
    userId: string,
    sessionHash: string,
  ): StoredProposal | undefined {
    const row = this.raw
      .prepare(
        "SELECT * FROM proposals WHERE id_hash = ? AND user_id = ? AND session_hash = ?",
      )
      .get(hash(id), userId, sessionHash) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    const result = row.result_json
      ? (JSON.parse(String(row.result_json)) as ExecutionResult)
      : undefined;
    return {
      idHash: String(row.id_hash),
      tool: String(row.tool) as ToolName,
      arguments: JSON.parse(String(row.arguments_json)) as ToolArguments,
      digest: String(row.proposal_digest),
      expiresAt: Number(row.expires_at),
      status: String(row.status) as StoredProposal["status"],
      version: Number(row.version),
      ...(result ? { result } : {}),
    };
  }

  completeProposal(
    id: string,
    userId: string,
    sessionHash: string,
    expectedVersion: number,
    expectedDigest: string,
    effect: () => Omit<ExecutionResult, "proposalId" | "replayed">,
    now = Date.now(),
  ): ExecutionResult {
    return this.raw.transaction(() => {
      const current = this.getProposal(id, userId, sessionHash);
      if (!current) throw new AppError("PROPOSAL_NOT_FOUND", 404);
      if (current.status === "consumed" && current.result)
        return { ...current.result, replayed: true };
      if (current.status !== "pending" || current.expiresAt <= now)
        throw new AppError("PROPOSAL_EXPIRED", 409, "Request a new proposal.");
      if (
        current.version !== expectedVersion ||
        current.digest !== expectedDigest
      )
        throw new AppError("STALE_PROPOSAL", 409, "Request a new proposal.");
      const output = effect();
      const result: ExecutionResult = {
        proposalId: id,
        replayed: false,
        ...output,
      };
      const changed = this.raw
        .prepare(
          "UPDATE proposals SET status = 'consumed', version = version + 1, result_json = ? WHERE id_hash = ? AND status = 'pending' AND version = ?",
        )
        .run(JSON.stringify(result), current.idHash, expectedVersion);
      if (changed.changes !== 1) throw new AppError("STALE_PROPOSAL", 409);
      return result;
    })();
  }

  schedule(userId: string, args: ToolArguments): Meeting {
    const title = String(args.title).trim();
    const roomId = String(args.roomId);
    const startAt = String(args.startAt);
    const endAt = String(args.endAt);
    const attendeeIds = [...new Set(args.attendeeIds as string[])].filter(
      (id) => id !== userId,
    );
    this.assertWindow(startAt, endAt);
    const room = this.listRooms().find((item) => item.id === roomId);
    if (!room) throw new AppError("ROOM_NOT_FOUND", 404);
    if (attendeeIds.length + 1 > room.capacity)
      throw new AppError("ROOM_CAPACITY", 409);
    this.assertUsers(attendeeIds);
    this.assertNoConflict(
      undefined,
      roomId,
      [userId, ...attendeeIds],
      startAt,
      endAt,
    );
    const id = `meeting-${randomUUID()}`;
    this.raw
      .prepare(
        "INSERT INTO meetings (id, title, organizer_id, room_id, classification, start_at, end_at, status, version) VALUES (?, ?, ?, ?, 'external', ?, ?, 'scheduled', 1)",
      )
      .run(id, title, userId, roomId, startAt, endAt);
    const add = this.raw.prepare(
      "INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)",
    );
    for (const attendee of attendeeIds) add.run(id, attendee);
    const meeting = this.findMeeting(id);
    if (!meeting) throw new AppError("DATABASE_FAILURE", 500);
    return meeting;
  }

  reschedule(args: ToolArguments): Meeting {
    const meetingId = String(args.meetingId);
    const expectedVersion = Number(args.expectedVersion);
    const current = this.findMeeting(meetingId);
    if (!current) throw new AppError("MEETING_NOT_FOUND", 404);
    if (current.status !== "scheduled")
      throw new AppError("INVALID_STATE", 409);
    const roomId = String(args.roomId);
    const startAt = String(args.startAt);
    const endAt = String(args.endAt);
    this.assertWindow(startAt, endAt);
    const room = this.listRooms().find((item) => item.id === roomId);
    if (!room) throw new AppError("ROOM_NOT_FOUND", 404);
    this.assertNoConflict(
      meetingId,
      roomId,
      [current.organizerId, ...current.attendeeIds],
      startAt,
      endAt,
    );
    const result = this.raw
      .prepare(
        "UPDATE meetings SET room_id = ?, start_at = ?, end_at = ?, version = version + 1 WHERE id = ? AND status = 'scheduled' AND version = ?",
      )
      .run(roomId, startAt, endAt, meetingId, expectedVersion);
    if (result.changes !== 1)
      throw new AppError(
        "STALE_MEETING",
        409,
        "State changed. Request a new proposal.",
      );
    return this.findMeeting(meetingId) as Meeting;
  }

  cancel(args: ToolArguments): Meeting {
    const meetingId = String(args.meetingId);
    const result = this.raw
      .prepare(
        "UPDATE meetings SET status = 'cancelled', version = version + 1 WHERE id = ? AND status = 'scheduled' AND version = ?",
      )
      .run(meetingId, Number(args.expectedVersion));
    if (result.changes !== 1)
      throw new AppError(
        "STALE_MEETING",
        409,
        "State changed. Request a new proposal.",
      );
    const meeting = this.findMeeting(meetingId);
    if (!meeting) throw new AppError("MEETING_NOT_FOUND", 404);
    return meeting;
  }

  availability(userIds: readonly string[], days: number): readonly string[] {
    this.assertUsers(userIds);
    const firstDay = new Date(this.suggestedWindow().startAt);
    firstDay.setUTCHours(0, 0, 0, 0);
    const slots: string[] = [];
    for (let day = 0; day < days && slots.length < 2; day += 1) {
      for (const hour of [9, 14]) {
        const start = at(addDays(firstDay, day), hour);
        const end = new Date(Date.parse(start) + 3_600_000).toISOString();
        if (
          Date.parse(start) > Date.now() &&
          !this.hasUserConflict(userIds, start, end)
        ) {
          slots.push(start);
          if (slots.length === 2) break;
        }
      }
    }
    return slots;
  }

  private assertWindow(startAt: string, endAt: string): void {
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= Date.now() ||
      end <= start ||
      end - start > 8 * 3_600_000
    )
      throw new AppError("INVALID_TIME", 422);
  }

  private assertUsers(ids: readonly string[]): void {
    for (const id of ids)
      if (!this.findUserById(id)) throw new AppError("USER_NOT_FOUND", 404);
  }

  private assertNoConflict(
    excludedMeetingId: string | undefined,
    roomId: string,
    userIds: readonly string[],
    startAt: string,
    endAt: string,
  ): void {
    const meetingIds = this.raw
      .prepare(
        `SELECT DISTINCT m.id FROM meetings m
       LEFT JOIN meeting_attendees a ON a.meeting_id = m.id
       WHERE m.status = 'scheduled' AND m.id != COALESCE(?, '')
         AND m.start_at < ? AND m.end_at > ?
         AND (m.room_id = ? OR m.organizer_id IN (${placeholders(userIds.length)}) OR a.user_id IN (${placeholders(userIds.length)}))`,
      )
      .all(
        excludedMeetingId ?? null,
        endAt,
        startAt,
        roomId,
        ...userIds,
        ...userIds,
      );
    if (meetingIds.length) throw new AppError("SCHEDULE_CONFLICT", 409);
  }

  private hasUserConflict(
    userIds: readonly string[],
    startAt: string,
    endAt: string,
  ): boolean {
    const row = this.raw
      .prepare(
        `SELECT 1 FROM meetings m
         LEFT JOIN meeting_attendees a ON a.meeting_id = m.id
         WHERE m.status = 'scheduled' AND m.start_at < ? AND m.end_at > ?
           AND (m.organizer_id IN (${placeholders(userIds.length)})
             OR a.user_id IN (${placeholders(userIds.length)}))
         LIMIT 1`,
      )
      .get(endAt, startAt, ...userIds, ...userIds);
    return Boolean(row);
  }
}

function mapUser(value: unknown): User | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!["employee", "contractor"].includes(String(row.kind))) return undefined;
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    kind: String(row.kind) as User["kind"],
  };
}

function mapRoom(row: Record<string, unknown>): Room {
  return {
    id: String(row.id),
    name: String(row.name),
    accessClass: String(row.access_class) as Room["accessClass"],
    capacity: Number(row.capacity),
  };
}

function meetingQuery(suffix: string): string {
  return `SELECT m.id, m.title, m.organizer_id, u.name AS organizer_name,
                 m.room_id, r.name AS room_name, r.access_class, r.capacity,
                 m.classification, m.start_at, m.end_at, m.status, m.version
          FROM meetings m JOIN users u ON u.id = m.organizer_id
          JOIN rooms r ON r.id = m.room_id ${suffix}`;
}

function nextMonday(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const days = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function at(date: Date, hour: number): string {
  const value = new Date(date);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function placeholders(count: number): string {
  return Array.from({ length: Math.max(1, count) }, () => "?").join(",");
}
