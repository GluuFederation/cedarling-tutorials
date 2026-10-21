import Database from "better-sqlite3";
import type {
  Audience,
  DraftInput,
  GradeState,
  Publication,
} from "../../shared/contracts.ts";
import { seed } from "./fixtures.ts";
import { SCHEMA_VERSION, schema } from "./schema.ts";

export type Principal = {
  id: string;
  name: string;
  role: Audience;
  schoolId: string;
  issuer: string;
};
export type Grade = {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  courseId: string;
  course: string;
  assessment: string;
  score: number | null;
  feedback: string;
  internalNote: string;
  state: GradeState;
  publishedAt: string | null;
  version: number;
};
export type Relationship = {
  version: number;
  state: string;
  expiresAt: number | null;
};
export type Snapshot = {
  principal: Principal;
  grade: Grade;
  assignment: Relationship | undefined;
  enrollment: Relationship | undefined;
  guardian: Relationship | undefined;
  guardianCurrent: boolean;
};
export const fixtureCommands = [
  "withdraw-enrollment",
  "restore-enrollment",
  "revoke-guardian",
  "restore-guardian",
] as const;
export type FixtureCommand = (typeof fixtureCommands)[number];

export class SchoolDatabase {
  readonly sql: Database.Database;
  constructor(path: string, issuer: string) {
    this.sql = new Database(path);
    try {
      this.sql.pragma("foreign_keys = ON");
      this.sql.pragma("journal_mode = WAL");
      this.sql.pragma("busy_timeout = 3000");
      const version = this.sql.pragma("user_version", { simple: true });
      const populated = this.sql
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        )
        .get();
      if (populated && version !== SCHEMA_VERSION)
        throw new Error(
          "P13 data uses a different baseline schema. Stop P13 and explicitly run pnpm reset, or choose a fresh data directory. Existing data was not replaced.",
        );
      if (!populated)
        this.sql.transaction(() => {
          this.sql.exec(schema);
          seed(this.sql, issuer);
          this.sql.pragma(`user_version = ${SCHEMA_VERSION}`);
        })();
    } catch (error) {
      this.sql.close();
      throw error;
    }
  }

  principal(id: string): Principal | undefined {
    return this.sql
      .prepare<[string], Principal>(
        "SELECT id,name,role,school_id schoolId,issuer FROM actors WHERE id=?",
      )
      .get(id);
  }

  snapshot(principalId: string, id: string): Snapshot | undefined {
    const principal = this.principal(principalId);
    const grade = this.sql
      .prepare<
        [string],
        Grade
      >(`SELECT g.id,g.student_id studentId,a.name studentName,
          c.school_id schoolId,g.course_id courseId,c.name course,g.assessment,
          g.score,g.feedback,g.internal_note internalNote,g.state,g.version,
          g.published_at publishedAt
        FROM grades g
        JOIN actors a ON a.id=g.student_id
        JOIN courses c ON c.id=g.course_id
        WHERE g.id=?`)
      .get(id);
    if (!principal || !grade || grade.schoolId !== principal.schoolId)
      return undefined;
    const assignment = this.sql
      .prepare<[string, string], Relationship>(
        "SELECT version,state,NULL expiresAt FROM assignments WHERE actor_id=? AND course_id=?",
      )
      .get(principalId, grade.courseId);
    const enrollment = this.sql
      .prepare<[string, string], Relationship>(
        "SELECT version,state,NULL expiresAt FROM enrollments WHERE student_id=? AND course_id=?",
      )
      .get(grade.studentId, grade.courseId);
    const guardian = this.sql
      .prepare<[string, string], Relationship>(
        "SELECT version,state,expires_at expiresAt FROM guardian_links WHERE guardian_id=? AND student_id=?",
      )
      .get(principalId, grade.studentId);
    return {
      principal,
      grade,
      assignment,
      enrollment,
      guardian,
      guardianCurrent:
        guardian?.state === "active" && (guardian.expiresAt ?? 0) > Date.now(),
    };
  }

  candidateIds(
    schoolId: string,
    filter: import("../../shared/contracts.ts").GradeFilter = {},
  ): string[] {
    return this.sql
      .prepare<
        [
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
        ],
        { id: string }
      >(
        `SELECT g.id FROM grades g
        JOIN courses c ON c.id=g.course_id
        WHERE c.school_id=? AND (? IS NULL OR g.student_id=?) AND (? IS NULL OR g.course_id=?) AND (? IS NULL OR g.state=?)
        ORDER BY c.name,g.assessment,g.id LIMIT 100`,
      )
      .all(
        schoolId,
        filter.studentId ?? null,
        filter.studentId ?? null,
        filter.courseId ?? null,
        filter.courseId ?? null,
        filter.state ?? null,
        filter.state ?? null,
      )
      .map((row) => row.id);
  }

  guard<T>(
    snapshots: readonly Snapshot[],
    effect: () => T,
  ): { current: false } | { current: true; value: T } {
    return this.sql
      .transaction(() => {
        if (
          snapshots.some(
            (snapshot) =>
              JSON.stringify(
                this.snapshot(snapshot.principal.id, snapshot.grade.id),
              ) !== JSON.stringify(snapshot),
          )
        )
          return { current: false as const };
        return { current: true as const, value: effect() };
      })
      .immediate();
  }

  write(snapshot: Snapshot, input: DraftInput): void {
    this.sql
      .prepare(
        `UPDATE grades SET score=?,feedback=?,internal_note=?,version=version+1
        WHERE id=? AND version=? AND state='draft'`,
      )
      .run(
        input.score,
        input.feedback,
        input.internalNote,
        snapshot.grade.id,
        input.expectedVersion,
      );
  }

  publish(snapshot: Snapshot, requestId: string): Publication {
    const publishedAt = new Date().toISOString();
    this.sql
      .prepare(
        `UPDATE grades SET
          state='published',version=version+1,published_at=?,published_by=?,
          authorized_grade_version=?,authorized_enrollment_version=?,
          authorized_assignment_version=?,publication_request_id=?,
          synthetic_decision=1,policy_release=NULL,policy_digest=NULL
        WHERE id=? AND version=? AND state='draft'`,
      )
      .run(
        publishedAt,
        snapshot.principal.id,
        snapshot.grade.version,
        snapshot.enrollment?.version ?? null,
        snapshot.assignment?.version ?? null,
        requestId,
        snapshot.grade.id,
        snapshot.grade.version,
      );
    return {
      id: snapshot.grade.id,
      state: "published",
      version: snapshot.grade.version + 1,
      publishedAt,
      requestId,
    };
  }

  changeFixture(command: FixtureCommand): {
    target: string;
    state: string;
    version: number;
  } {
    return this.sql
      .transaction(() => {
        if (
          command === "withdraw-enrollment" ||
          command === "restore-enrollment"
        ) {
          const state =
            command === "withdraw-enrollment" ? "withdrawn" : "active";
          const changed = this.sql
            .prepare<[string], { version: number }>(
              `UPDATE enrollments SET state=?,version=version+1
              WHERE student_id='sam' AND course_id='algebra' RETURNING version`,
            )
            .get(state);
          if (!changed) throw new Error("Seeded enrollment is missing");
          return { target: "sam/algebra", state, version: changed.version };
        }
        const state = command === "revoke-guardian" ? "revoked" : "active";
        const changed = this.sql
          .prepare<[string, number], { version: number }>(
            `UPDATE guardian_links SET state=?,expires_at=?,version=version+1
            WHERE guardian_id='grace' AND student_id='sam' RETURNING version`,
          )
          .get(state, Date.now() + 24 * 60 * 60 * 1000);
        if (!changed) throw new Error("Seeded guardian link is missing");
        return { target: "grace/sam", state, version: changed.version };
      })
      .immediate();
  }

  close(): void {
    this.sql.close();
  }
}
