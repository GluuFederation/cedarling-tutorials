import Database from "better-sqlite3";
import {
  type Audience,
  accounts,
  type DraftInput,
  type GradeState,
  type Publication,
} from "../shared/contracts.ts";

type Principal = {
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
type Relationship = {
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
    this.sql.pragma("foreign_keys = ON");
    this.sql.pragma("journal_mode = WAL");
    this.sql.pragma("busy_timeout = 3000");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS actors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        school_id TEXT NOT NULL,
        issuer TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        school_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        actor_id TEXT NOT NULL REFERENCES actors(id),
        course_id TEXT NOT NULL REFERENCES courses(id),
        state TEXT NOT NULL CHECK (state IN ('active','revoked')),
        version INTEGER NOT NULL CHECK(version > 0),
        PRIMARY KEY(actor_id,course_id)
      );
      CREATE TABLE IF NOT EXISTS enrollments (
        student_id TEXT NOT NULL REFERENCES actors(id),
        course_id TEXT NOT NULL REFERENCES courses(id),
        state TEXT NOT NULL CHECK (state IN ('active','withdrawn')),
        version INTEGER NOT NULL CHECK(version > 0),
        PRIMARY KEY(student_id,course_id)
      );
      CREATE TABLE IF NOT EXISTS guardian_links (
        guardian_id TEXT NOT NULL REFERENCES actors(id),
        student_id TEXT NOT NULL REFERENCES actors(id),
        state TEXT NOT NULL CHECK(state IN ('active','revoked')),
        expires_at INTEGER NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        PRIMARY KEY(guardian_id,student_id)
      );
      CREATE TABLE IF NOT EXISTS grades (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES actors(id),
        course_id TEXT NOT NULL REFERENCES courses(id),
        assessment TEXT NOT NULL,
        score INTEGER CHECK(
          score IS NULL OR (typeof(score)='integer' AND score BETWEEN 0 AND 100)
        ),
        feedback TEXT NOT NULL CHECK(length(feedback)<=2000),
        internal_note TEXT NOT NULL CHECK(length(internal_note)<=1000),
        state TEXT NOT NULL CHECK(state IN ('draft','published')),
        version INTEGER NOT NULL CHECK(version>0),
        published_at TEXT,
        published_by TEXT REFERENCES actors(id),
        authorized_grade_version INTEGER,
        authorized_enrollment_version INTEGER,
        authorized_assignment_version INTEGER,
        publication_request_id TEXT,
        synthetic_decision INTEGER,
        policy_release TEXT,
        policy_digest TEXT,
        CHECK(state='draft' OR (
          score IS NOT NULL AND length(trim(feedback))>0
          AND published_at IS NOT NULL AND published_by IS NOT NULL
          AND publication_request_id IS NOT NULL
        ))
      );
      CREATE TRIGGER IF NOT EXISTS immutable_publication
      BEFORE UPDATE ON grades WHEN OLD.state='published'
      BEGIN
        SELECT RAISE(ABORT,'Published grades are immutable');
      END;
    `);
    this.sql.transaction(() => {
      const actor = this.sql.prepare(
        "INSERT OR IGNORE INTO actors VALUES (?, ?, ?, ?, ?)",
      );
      for (const { id, name, role } of accounts)
        actor.run(id, name, role, "school-a", issuer);
      for (const [id, name, role, school] of [
        ["ava", "Ava", "student", "school-a"],
        ["rene", "René", "teacher", "school-a"],
        ["foreign", "Foreign student", "student", "school-b"],
      ])
        actor.run(id, name, role, school, issuer);
      const course = this.sql.prepare(
        "INSERT OR IGNORE INTO courses VALUES (?,?,?)",
      );
      course.run("algebra", "Algebra", "school-a");
      course.run("biology", "Biology", "school-a");
      course.run("foreign", "Foreign course", "school-b");
      this.sql.exec(`
        INSERT OR IGNORE INTO assignments VALUES
          ('talia','algebra','active',1), ('rene','biology','active',1);
        INSERT OR IGNORE INTO enrollments VALUES
          ('sam','algebra','active',1), ('ava','biology','active',1),
          ('foreign','foreign','active',1);
      `);
      this.sql
        .prepare(
          "INSERT OR IGNORE INTO guardian_links VALUES ('grace','sam','active',?,1)",
        )
        .run(Date.now() + 24 * 60 * 60 * 1000);
      const grade = this.sql.prepare(
        `INSERT OR IGNORE INTO grades (
          id,student_id,course_id,assessment,score,feedback,internal_note,state,version
        ) VALUES (?,?,?,?,?,?,?,'draft',1)`,
      );
      grade.run(
        "grade-sam-1",
        "sam",
        "algebra",
        "Quiz 1",
        85,
        "Clear working.",
        "Check reasoning privately.",
      );
      grade.run(
        "grade-sam-2",
        "sam",
        "algebra",
        "Quiz 2",
        null,
        "",
        "Discuss the next exercise privately.",
      );
      grade.run(
        "grade-ava-1",
        "ava",
        "biology",
        "Lab 1",
        92,
        "Accurate observations.",
        "Teacher-only observation.",
      );
      grade.run(
        "grade-foreign-1",
        "foreign",
        "foreign",
        "Quiz 1",
        90,
        "Synthetic fixture.",
        "Foreign-school note.",
      );
    })();
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

  candidateIds(schoolId: string): string[] {
    return this.sql
      .prepare<[string], { id: string }>(
        `SELECT g.id FROM grades g
        JOIN courses c ON c.id=g.course_id
        WHERE c.school_id=?
        ORDER BY c.name,g.assessment,g.id LIMIT 100`,
      )
      .all(schoolId)
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
