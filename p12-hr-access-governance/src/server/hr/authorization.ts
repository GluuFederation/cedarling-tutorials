import type { Capability, PackageId, Profile } from "../../shared/contracts.ts";
import type { GrantRow, Principal } from "../data/database.ts";
export type GrantFacts = Omit<GrantRow, "reason" | "reviewNote">;
export type Facts = Readonly<{
  principal: Principal;
  employee?: Omit<Profile, "managerName"> & { tenantId: string };
  manager?: Principal;
  beneficiary?: Principal;
  grant?: GrantFacts;
  effectiveGrant?: GrantFacts;
  medicalVersion?: number | null;
  package: { id: PackageId; scope: string; fieldGroup: string };
}>;
export type DecisionInput = Readonly<{
  capability: Capability;
  intent: "read" | "execute";
  resourceId: string;
  facts: Facts;
  parameters: Readonly<{
    durationDays?: number;
    expectedVersion?: number;
    packageId?: PackageId;
    beneficiaryId?: string;
  }>;
  requestId: string;
  now: number;
}>;
export type Authorize = (input: DecisionInput) => Promise<void>;
export const fakeAuthorize: Authorize = async (input) => {
  console.info(
    `P12 server | FAKE ALLOW | ${input.capability} | ${input.facts.principal.id} -> ${input.resourceId} | ${input.requestId}`,
  );
};
