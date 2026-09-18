export const capabilities = {
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
export type ReadCapability = {
  [K in Capability]: (typeof capabilities)[K] extends { kind: "read" }
    ? K
    : never;
}[Capability];
export type Audience = (typeof capabilities)[ReadCapability]["audience"];
export const accounts = [
  { id: "talia", name: "Talia", role: "teacher" },
  { id: "sam", name: "Sam Rivera", role: "student" },
  { id: "grace", name: "Grace", role: "guardian" },
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
