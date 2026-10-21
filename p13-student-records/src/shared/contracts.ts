export const capabilities = {
  "student.profile.view": {
    feature: "P13-F6",
    action: "School::ViewStudentProfile",
    kind: "profile",
  },
  "grade.teacher.view": {
    feature: "P13-F1",
    action: "School::ViewTeacherGrade",
    kind: "read",
    audience: "teacher",
  },
  "grade.write": {
    feature: "P13-F2",
    action: "School::WriteGrade",
    kind: "mutation",
  },
  "grade.publish": {
    feature: "P13-F3",
    action: "School::PublishGrade",
    kind: "mutation",
  },
  "grade.published.view": {
    feature: "P13-F4",
    action: "School::ViewPublishedGrade",
    kind: "read",
    audience: "student",
  },
  "guardian.grade.view": {
    feature: "P13-F5",
    action: "School::ViewGuardianGrade",
    kind: "read",
    audience: "guardian",
  },
} as const;

export type Capability = keyof typeof capabilities;
export type GradeCapability = Exclude<Capability, "student.profile.view">;
export type ReadCapability = {
  [K in Capability]: (typeof capabilities)[K] extends { kind: "read" }
    ? K
    : never;
}[Capability];
export type Audience = (typeof capabilities)[ReadCapability]["audience"];
export const accounts = [
  { id: "talia", name: "Talia", role: "teacher" },
  { id: "rene", name: "René", role: "teacher" },
  { id: "sam", name: "Sam Rivera", role: "student" },
  { id: "ava", name: "Ava", role: "student" },
  { id: "grace", name: "Grace", role: "guardian" },
  { id: "imani", name: "Imani", role: "guardian" },
] as const;
export type AccountId = (typeof accounts)[number]["id"];
export function isAccountId(value: unknown): value is AccountId {
  return accounts.some((account) => account.id === value);
}

export type GradeState = "draft" | "published";
type GradeSummary = {
  course: string;
  assessment: string;
  publishedAt: string | null;
  version: number;
};
type TeacherGrade = GradeSummary & {
  studentId: string;
  studentName: string;
  score: number | null;
  feedback: string;
  internalNote: string;
  state: GradeState;
};
type StudentGrade = GradeSummary & {
  score: number | null;
  letterGrade: string | null;
  feedback: string;
};
type GuardianGrade = GradeSummary & { letterGrade: string | null };
export type GradeProjection = TeacherGrade | StudentGrade | GuardianGrade;
export type GradeView = { id: string; grade: GradeProjection };
export type DraftInput = {
  expectedVersion: number;
  score: number | null;
  feedback: string;
  internalNote: string;
};
export type Publication = {
  id: string;
  state: "published";
  version: number;
  publishedAt: string;
  requestId: string;
};
export type SessionView = {
  user: { id: AccountId; name: string; role: Audience };
  csrfToken: string;
  expiresAt: number;
};

export type StudentSummary = {
  id: string;
  studentNumber: string;
  name: string;
  className: string;
  yearGroup: string;
  enrollmentStatus: "Active" | "Withdrawn";
};
export type StudentProfile = StudentSummary & {
  preferredName: string;
  admittedOn: string;
  academicYear: string;
  version: number;
  enrollments: readonly {
    courseId: string;
    course: string;
    state: "active" | "withdrawn";
  }[];
};
export type GradeFilter = {
  studentId?: string;
  courseId?: string;
  state?: GradeState;
};
