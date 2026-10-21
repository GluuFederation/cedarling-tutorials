export const capabilities = {
  "grant.request": "HR::RequestGrant",
  "grant.approve": "HR::ApproveGrant",
  "grant.reject": "HR::RejectGrant",
  "grant.revoke": "HR::RevokeGrant",
  "employee.profile.view": "HR::ViewProfile",
  "employee.contact.view": "HR::ViewContact",
  "employee.medical.view": "HR::ViewMedical",
} as const;
export type Capability = keyof typeof capabilities;
export const accounts = [
  { id: "lin", name: "Lin", role: "HR administrator · Reviewer" },
  { id: "nia", name: "Nia", role: "Reviewer" },
  { id: "ben", name: "Ben", role: "Manager" },
  { id: "aya", name: "Dr. Aya", role: "Occupational-health clinician" },
] as const;
export const accessPackages = [
  {
    id: "team-support",
    name: "Contact details",
    scope: "current-direct-reports",
    fieldGroup: "contact",
  },
  {
    id: "occupational-health",
    name: "Medical records",
    scope: "occupational-health-case",
    fieldGroup: "medical",
  },
] as const;
export type PackageId = (typeof accessPackages)[number]["id"];
export type GrantStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked"
  | "expired";
export type GrantOperation = "approve" | "reject" | "revoke";
export type Grant = Readonly<{
  id: string;
  packageId: PackageId;
  packageName: string;
  employeeId: string;
  employeeName: string;
  requesterId: string;
  requesterName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  scope: string;
  reason: string;
  durationDays: number;
  status: GrantStatus;
  createdAt: number;
  reviewDeadline: number;
  approvedAt: number | null;
  expiresAt: number | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewedAt: number | null;
  reviewNote: string | null;
  revokedBy: string | null;
  revokerName: string | null;
  revokedAt: number | null;
  version: number;
}>;
export type Profile = Readonly<{
  id: string;
  employeeNumber: string;
  name: string;
  preferredName: string;
  managerId: string;
  managerName: string;
  team: string;
  jobTitle: string;
  office: string;
  employmentType: string;
  employmentStatus: "Active" | "On leave";
  startDate: string;
  version: number;
}>;
export type Contact = Readonly<{
  id: string;
  workEmail: string;
  workPhone: string;
  personalEmail: string;
  mobilePhone: string;
  address: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  version: number;
}>;
export type MedicalEntry = Readonly<{
  date: string;
  title: string;
  details: string;
}>;
export type Medical = Readonly<{
  id: string;
  dateOfBirth: string;
  bloodGroup: string;
  allergies: readonly string[];
  conditions: readonly MedicalEntry[];
  medications: readonly MedicalEntry[];
  consultations: readonly MedicalEntry[];
  testResults: readonly MedicalEntry[];
  vaccinations: readonly MedicalEntry[];
  assessments: readonly MedicalEntry[];
  version: number;
}>;
export type AccessOptions = Readonly<{
  packages: typeof accessPackages;
  beneficiaries: readonly { id: string; name: string; role: string }[];
}>;
export type GrantRequest = Readonly<{
  employeeId: string;
  packageId: PackageId;
  days: number;
  reason: string;
  beneficiaryId?: string;
}>;
export type SessionView = Readonly<{
  user: { id: string; name: string; role: string };
  csrfToken: string;
  expiresAt: number;
}>;
export type Result<T> = Readonly<{ data: T; requestId: string }>;
