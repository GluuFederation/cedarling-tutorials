import type Sqlite from "better-sqlite3";
import { accounts } from "../../shared/contracts.ts";

const students = [
  ["sam", "Sam Rivera", "Sam"],
  ["ava", "Ava", "Ava"],
  ["maya", "Maya Okafor", "Maya"],
  ["leo", "Leo Martin", "Leo"],
  ["zara", "Zara Diallo", "Zara"],
  ["mei", "Mei Chen", "Mei"],
  ["niko", "Niko Costa", "Niko"],
  ["ines", "Ines Laurent", "Ines"],
] as const;
export function seed(sql: Sqlite.Database, issuer: string) {
  const actor = sql.prepare("INSERT OR IGNORE INTO actors VALUES (?,?,?,?,?)");
  for (const item of accounts)
    actor.run(item.id, item.name, item.role, "school-a", issuer);
  for (const [id, name] of students)
    actor.run(id, name, "student", "school-a", issuer);
  actor.run("foreign", "Foreign student", "student", "school-b", issuer);
  const student = sql.prepare("INSERT INTO students VALUES (?,?,?,?,?,?,?,1)");
  for (const [i, [id, , preferred]] of students.entries())
    student.run(
      id,
      `STU-${1001 + i}`,
      preferred,
      i < 4 ? "10A" : "10B",
      "Year 10",
      "2026/27",
      "2025-09-01",
    );
  student.run(
    "foreign",
    "OTHER-1001",
    "Other",
    "10C",
    "Year 10",
    "2026/27",
    "2025-09-01",
  );
  sql.exec(
    "INSERT INTO courses VALUES ('algebra','Algebra','school-a'),('biology','Biology','school-a'),('foreign','Foreign course','school-b'); INSERT INTO assignments VALUES ('talia','algebra','active',1),('rene','biology','active',1);",
  );
  const enrollment = sql.prepare(
    "INSERT INTO enrollments VALUES (?,?,'active',1)",
  );
  const grade = sql.prepare(
    "INSERT INTO grades (id,student_id,course_id,assessment,score,feedback,internal_note,state,version,published_at,published_by,authorized_grade_version,authorized_enrollment_version,authorized_assignment_version,publication_request_id,synthetic_decision) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)",
  );
  for (const [index, [id]] of students.entries()) {
    for (const course of ["algebra", "biology"]) {
      enrollment.run(id, course);
      for (let assessment = 1; assessment <= 2; assessment++) {
        const originalSam = id === "sam" && course === "algebra";
        const originalAva =
          id === "ava" && course === "biology" && assessment === 1;
        const gradeId = originalSam
          ? `grade-sam-${assessment}`
          : originalAva
            ? "grade-ava-1"
            : `grade-${id}-${course}-${assessment}`;
        const published =
          !originalSam &&
          !originalAva &&
          (index + assessment + (course === "biology" ? 1 : 0)) % 3 === 0;
        const incomplete =
          (originalSam && assessment === 2) ||
          (!published &&
            !originalAva &&
            !originalSam &&
            (index + assessment) % 4 === 0);
        const score = incomplete
          ? null
          : originalSam
            ? 85
            : originalAva
              ? 92
              : 64 + ((index * 3 + assessment * 5) % 35);
        const feedback = incomplete
          ? ""
          : originalSam
            ? "Clear working."
            : originalAva
              ? "Accurate observations."
              : "Your explanation follows the method. Check the final step.";
        const note = originalSam
          ? assessment === 1
            ? "Check reasoning privately."
            : "Discuss the next exercise privately."
          : originalAva
            ? "Teacher-only observation."
            : "Review the working at the next lesson.";
        grade.run(
          gradeId,
          id,
          course,
          (course === "algebra" ? "Quiz " : "Lab ") + assessment,
          score,
          feedback,
          note,
          published ? "published" : "draft",
          published ? "2026-10-01T10:00:00.000Z" : null,
          published ? (course === "algebra" ? "talia" : "rene") : null,
          published ? 1 : null,
          published ? 1 : null,
          published ? 1 : null,
          published ? `seed-${gradeId}` : null,
          published ? 1 : null,
        );
      }
    }
  }
  enrollment.run("foreign", "foreign");
  grade.run(
    "grade-foreign-1",
    "foreign",
    "foreign",
    "Quiz 1",
    90,
    "Synthetic fixture.",
    "Foreign-school note.",
    "draft",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  const guardian = sql.prepare(
    "INSERT INTO guardian_links VALUES (?,?,'active',?,1)",
  );
  for (const [parent, child] of [
    ["grace", "sam"],
    ["grace", "maya"],
    ["imani", "ava"],
  ])
    guardian.run(parent, child, Date.now() + 86400000);
}
