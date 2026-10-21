import type { Authorize } from "../src/server/hr/authorization.ts";
import { AppError } from "../src/server/http/errors.ts";
import type { GrantRequest } from "../src/shared/contracts.ts";
export const unavailable: Authorize = async () => {
  throw new AppError(
    503,
    "AUTHORIZATION_UNAVAILABLE",
    "Authorization is unavailable. Try again later.",
  );
};
export function contactRequest(employeeId = "cora", days = 1): GrantRequest {
  return {
    employeeId,
    days,
    packageId: "team-support",
    reason: "Coordinate employee support arrangements.",
  };
}
export function medicalRequest(employeeId = "cora", days = 1): GrantRequest {
  return {
    employeeId,
    days,
    packageId: "occupational-health",
    beneficiaryId: "aya",
    reason: "Review the occupational-health case.",
  };
}
