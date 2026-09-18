export const capabilities = {
  "grant.request": "HR::RequestGrant",
  "grant.approve": "HR::ApproveGrant",
  "grant.revoke": "HR::RevokeGrant",
  "employee.profile.view": "HR::ViewProfile",
  "employee.contact.view": "HR::ViewContact",
} as const;
export type Capability = keyof typeof capabilities;
export const accounts = [
  { id: "lin", name: "Lin", role: "HR administrator · Reviewer" },
  { id: "nia", name: "Nia", role: "Reviewer" },
  { id: "ben", name: "Ben", role: "Manager" },
] as const;
export type GrantStatus = "pending" | "approved" | "revoked" | "expired";
export type Grant = Readonly<{
  id: string;
  packageId: string;
  employeeId: string;
  employeeName: string;
  requesterId: string;
  requesterName: string;
  managerId: string;
  managerName: string;
  scope: string;
  status: GrantStatus;
  expiresAt: number;
  version: number;
}>;
export type Profile = Readonly<{
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  team: string;
  jobTitle: string;
  version: number;
}>;
export type Contact = Readonly<{
  id: string;
  workEmail: string;
  workPhone: string;
  version: number;
}>;
export type SessionView = Readonly<{
  user: { id: string; name: string; role: string };
  csrfToken: string;
  expiresAt: number;
}>;
export type Result<T> = Readonly<{ data: T; requestId: string }>;
