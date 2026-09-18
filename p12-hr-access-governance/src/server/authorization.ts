import type { Capability } from "../shared/contracts.ts";
import type { Employee, GrantRow, Principal } from "./database.ts";
import { AppError } from "./errors.ts";
export type Facts = Readonly<{
  principal: Principal;
  grant?: GrantRow;
  employee?: Employee;
  manager?: Principal;
  effectiveGrant?: GrantRow;
  package: { id: string; scope: string; fieldGroups: string };
}>;
export type DecisionInput = Readonly<{
  capability: Capability;
  intent: "read" | "execute";
  resourceId: string;
  facts: Facts;
  parameters: Readonly<{
    durationDays?: number;
    expectedVersion?: number;
  }>;
  requestId: string;
  now: number;
}>;
export type Authorize = (input: DecisionInput) => Promise<void>;
export const fakeAuthorize: Authorize = async (input) => {
  console.info(
    `P12 server | FAKE ALLOW | ${input.capability} | ${input.facts.principal.id} -> ${input.resourceId}`,
  );
};
export const unavailable: Authorize = async () => {
  throw new AppError(
    503,
    "AUTHORIZATION_UNAVAILABLE",
    "Authorization is unavailable. Try again later.",
  );
};
