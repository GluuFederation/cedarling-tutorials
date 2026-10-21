import type { StudentProfile, StudentSummary } from "../../shared/contracts.ts";
import type {
  Principal,
  Relationship,
  SchoolDatabase,
} from "../data/database.ts";
import { AppError } from "../http/errors.ts";
import type { Authorize } from "./service.ts";
export type StudentFacts = {
  principal: Principal;
  student: StudentProfile & { schoolId: string };
  assignments: readonly { courseId: string; state: string; version: number }[];
  enrollments: readonly { courseId: string; state: string; version: number }[];
  guardian: Relationship | undefined;
  guardianCurrent: boolean;
};
export class Students {
  private readonly db: SchoolDatabase;
  private readonly authorize: Authorize;
  private readonly beforeEffect: () => void;
  constructor(
    db: SchoolDatabase,
    authorize: Authorize,
    beforeEffect: () => void = () => {},
  ) {
    this.db = db;
    this.authorize = authorize;
    this.beforeEffect = beforeEffect;
  }
  private snapshot(actorId: string, id: string): StudentFacts {
    const principal = this.db.principal(actorId);
    const row = this.db.sql
      .prepare<
        [string],
        {
          id: string;
          name: string;
          schoolId: string;
          studentNumber: string;
          preferredName: string;
          className: string;
          yearGroup: string;
          academicYear: string;
          admittedOn: string;
          version: number;
        }
      >(
        "SELECT s.id,a.name,a.school_id schoolId,s.student_number studentNumber,s.preferred_name preferredName,s.class_name className,s.year_group yearGroup,s.academic_year academicYear,s.admitted_on admittedOn,s.version FROM students s JOIN actors a ON a.id=s.id WHERE s.id=?",
      )
      .get(id);
    if (!principal || !row || principal.schoolId !== row.schoolId)
      throw new AppError(
        404,
        "NOT_FOUND",
        "Student record not found or unavailable.",
      );
    const enrollments = this.db.sql
      .prepare<
        [string],
        StudentProfile["enrollments"][number] & { version: number }
      >(
        "SELECT e.course_id courseId,c.name course,e.state,e.version FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? ORDER BY c.id",
      )
      .all(id);
    const assignments = this.db.sql
      .prepare<[string], { courseId: string; state: string; version: number }>(
        "SELECT course_id courseId,state,version FROM assignments WHERE actor_id=? ORDER BY course_id",
      )
      .all(actorId);
    const guardian = this.db.sql
      .prepare<[string, string], Relationship>(
        "SELECT version,state,expires_at expiresAt FROM guardian_links WHERE guardian_id=? AND student_id=?",
      )
      .get(actorId, id);
    return {
      principal,
      student: {
        ...row,
        enrollmentStatus: enrollments.some((e) => e.state === "active")
          ? "Active"
          : "Withdrawn",
        enrollments: enrollments.map(({ courseId, course, state }) => ({
          courseId,
          course,
          state,
        })),
      },
      assignments,
      enrollments: enrollments.map(({ courseId, state, version }) => ({
        courseId,
        state,
        version,
      })),
      guardian,
      guardianCurrent:
        guardian?.state === "active" && (guardian.expiresAt ?? 0) > Date.now(),
    };
  }
  private project(facts: StudentFacts): StudentProfile {
    const { schoolId: _, ...profile } = facts.student;
    return profile;
  }
  async list(actor: string, requestId: string): Promise<StudentSummary[]> {
    const principal = this.db.principal(actor);
    if (!principal)
      throw new AppError(
        404,
        "NOT_FOUND",
        "Student record not found or unavailable.",
      );
    const ids = this.db.sql
      .prepare<[string], { id: string }>(
        "SELECT s.id FROM students s JOIN actors a ON a.id=s.id WHERE a.school_id=? ORDER BY a.name LIMIT 100",
      )
      .all(principal.schoolId)
      .map((row) => row.id);
    return this.run(actor, ids, requestId, (facts) =>
      facts.map(({ student }) => ({
        id: student.id,
        name: student.name,
        studentNumber: student.studentNumber,
        className: student.className,
        yearGroup: student.yearGroup,
        enrollmentStatus: student.enrollmentStatus,
      })),
    );
  }
  async read(
    actor: string,
    id: string,
    requestId: string,
  ): Promise<StudentProfile> {
    return this.run(actor, [id], requestId, (facts) => {
      const value = facts[0];
      if (!value)
        throw new AppError(
          404,
          "NOT_FOUND",
          "Student record not found or unavailable.",
        );
      return this.project(value);
    });
  }
  private async run<T>(
    actor: string,
    ids: readonly string[],
    requestId: string,
    project: (facts: StudentFacts[]) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const facts = ids.map((id) => this.snapshot(actor, id));
      const allowed: StudentFacts[] = [];
      for (const fact of facts) {
        const result = await this.authorize({
          capability: "student.profile.view",
          facts: fact,
          requestId,
        });
        if (result === "allow") allowed.push(fact);
        else if (result !== "deny")
          throw new AppError(
            503,
            "AUTHORIZATION_UNAVAILABLE",
            "Authorization unavailable. Try again.",
          );
      }
      const current = this.db.sql
        .transaction(() => {
          this.beforeEffect();
          if (
            facts.some(
              (fact) =>
                JSON.stringify(this.snapshot(actor, fact.student.id)) !==
                JSON.stringify(fact),
            )
          )
            return { current: false as const };
          return { current: true as const, value: project(allowed) };
        })
        .immediate();
      if (current.current) return current.value;
    }
    throw new AppError(
      409,
      "CONFLICT",
      "The student record or its relationships changed. Reload and try again.",
    );
  }
}
