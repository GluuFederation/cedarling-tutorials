import type {
  Contact,
  Grant,
  Medical,
  Profile,
} from "../../shared/contracts.ts";
export type Principal = Readonly<{
  id: string;
  name: string;
  tenantId: string;
  role: string;
  administrator: number;
  reviewer: number;
  clinician: number;
  version: number;
}>;
export type Employee = Omit<Profile, "managerName"> &
  Omit<Contact, "id" | "version"> &
  Readonly<{ tenantId: string }>;
export type GrantRow = Omit<
  Grant,
  | "packageName"
  | "employeeName"
  | "requesterName"
  | "beneficiaryName"
  | "reviewerName"
  | "revokerName"
> &
  Readonly<{ tenantId: string }>;
export type MedicalRow = Readonly<{
  employeeId: string;
  value: string;
  version: number;
}>;
export type MedicalData = Omit<Medical, "id" | "version">;
export type Session = Readonly<{
  id: string;
  principalId: string;
  csrfToken: string;
  expiresAt: number;
}>;
export type LoginTransaction = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
}>;
