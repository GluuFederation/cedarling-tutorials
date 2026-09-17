import type {
  Capability,
  DraftInput,
  GradeProjection,
  GradeView,
  Publication,
  ReadCapability,
} from "../shared/contracts.ts";
import type { Grade, SchoolDatabase, Snapshot } from "./database.ts";
import { AppError, conflict, invalid, missing } from "./errors.ts";

type AuthorizationRequest = {
  capability: Capability;
  requestId: string;
  facts: Omit<Snapshot, "grade"> & {
    grade: Pick<
      Grade,
      "id" | "schoolId" | "studentId" | "courseId" | "state" | "version"
    > & { complete: boolean };
  };
};
export type Authorize = (
  request: AuthorizationRequest,
) => Promise<"allow" | "deny" | "unavailable">;

function complete(grade: Grade): boolean {
  return grade.score !== null && Boolean(grade.feedback.trim());
}
function letter(score: number | null): string | null {
  if (score === null) return null;
  return score >= 90
    ? "A"
    : score >= 80
      ? "B"
      : score >= 70
        ? "C"
        : score >= 60
          ? "D"
          : "F";
}
function project(grade: Grade, capability: ReadCapability): GradeProjection {
  const common = {
    course: grade.course,
    assessment: grade.assessment,
    publishedAt: grade.publishedAt,
    version: grade.version,
  };
  if (capability === "grade.teacher.view")
    return {
      ...common,
      studentId: grade.studentId,
      studentName: grade.studentName,
      score: grade.score,
      feedback: grade.feedback,
      internalNote: grade.internalNote,
      state: grade.state,
    };
  if (capability === "grade.published.view")
    return {
      ...common,
      score: grade.score,
      letterGrade: letter(grade.score),
      feedback: grade.feedback,
    };
  return { ...common, letterGrade: letter(grade.score) };
}

export class School {
  private readonly database: SchoolDatabase;
  private readonly authorize: Authorize;
  constructor(database: SchoolDatabase, authorize: Authorize) {
    this.database = database;
    this.authorize = authorize;
  }

  async read(
    principalId: string,
    capability: ReadCapability,
    id: string,
    requestId: string = crypto.randomUUID(),
  ): Promise<GradeView> {
    return this.effect(principalId, capability, id, requestId, (snapshot) => ({
      id,
      grade: project(snapshot.grade, capability),
    }));
  }

  async list(
    principalId: string,
    capability: ReadCapability,
    requestId: string,
  ): Promise<GradeView[]> {
    const principal = this.database.principal(principalId);
    if (!principal) throw missing();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshots = this.database
        .candidateIds(principal.schoolId)
        .map((id) => this.database.snapshot(principalId, id))
        .filter((snapshot): snapshot is Snapshot => snapshot !== undefined);
      const allowed: Snapshot[] = [];
      for (const snapshot of snapshots) {
        if ((await this.decide(snapshot, capability, requestId)) === "allow")
          allowed.push(snapshot);
      }
      const result = this.database.guard(snapshots, () =>
        allowed.map((snapshot) => ({
          id: snapshot.grade.id,
          grade: project(snapshot.grade, capability),
        })),
      );
      if (result.current) return result.value;
    }
    throw conflict();
  }

  async write(
    principalId: string,
    id: string,
    input: DraftInput,
    requestId: string,
  ): Promise<GradeView> {
    if (
      input.score !== null &&
      (!Number.isInteger(input.score) || input.score < 0 || input.score > 100)
    )
      throw invalid();
    if (
      typeof input.feedback !== "string" ||
      input.feedback.length > 2000 ||
      typeof input.internalNote !== "string" ||
      input.internalNote.length > 1000
    )
      throw invalid();
    return this.effect(
      principalId,
      "grade.write",
      id,
      requestId,
      (snapshot) => {
        this.database.write(snapshot, input);
        return {
          id,
          grade: project(
            {
              ...snapshot.grade,
              ...input,
              version: snapshot.grade.version + 1,
            },
            "grade.teacher.view",
          ),
        };
      },
      input.expectedVersion,
    );
  }

  async publish(
    principalId: string,
    id: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<Publication> {
    return this.effect(
      principalId,
      "grade.publish",
      id,
      requestId,
      (snapshot) => this.database.publish(snapshot, requestId),
      expectedVersion,
    );
  }

  private async effect<T>(
    principalId: string,
    capability: Capability,
    id: string,
    requestId: string,
    effect: (snapshot: Snapshot) => T,
    expectedVersion?: number,
  ): Promise<T> {
    if (
      expectedVersion !== undefined &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    )
      throw invalid();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = this.database.snapshot(principalId, id);
      if (!snapshot) throw missing();
      if (
        expectedVersion !== undefined &&
        (snapshot.grade.version !== expectedVersion ||
          snapshot.grade.state !== "draft")
      )
        throw conflict();
      if (capability === "grade.publish" && !complete(snapshot.grade))
        throw new AppError(
          422,
          "INCOMPLETE_GRADE",
          "Save a score and student feedback before publishing.",
        );
      const decision = await this.decide(snapshot, capability, requestId);
      if (decision === "deny") throw missing();
      const result = this.database.guard([snapshot], () => effect(snapshot));
      if (result.current) return result.value;
    }
    throw conflict();
  }

  private async decide(
    snapshot: Snapshot,
    capability: Capability,
    requestId: string,
  ) {
    const { id, schoolId, studentId, courseId, state, version } =
      snapshot.grade;
    const decision = await this.authorize({
      capability,
      requestId,
      facts: {
        ...snapshot,
        grade: {
          id,
          schoolId,
          studentId,
          courseId,
          state,
          version,
          complete: complete(snapshot.grade),
        },
      },
    });
    if (decision !== "allow" && decision !== "deny")
      throw new AppError(
        503,
        "AUTHORIZATION_UNAVAILABLE",
        "Authorization unavailable. Try again.",
      );
    return decision;
  }
}
