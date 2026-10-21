export const SCHEMA_VERSION = 2;
export const schema = `
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
CREATE TABLE students (
 id TEXT PRIMARY KEY REFERENCES actors(id), student_number TEXT NOT NULL UNIQUE,
 preferred_name TEXT NOT NULL, class_name TEXT NOT NULL, year_group TEXT NOT NULL,
 academic_year TEXT NOT NULL, admitted_on TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0)
);
`;
