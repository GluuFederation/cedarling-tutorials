import type { Authorize } from "./service.ts";
export function createAuthorization(
  log: (line: string) => void = console.info,
): Authorize {
  return async (input) => {
    const target =
      input.capability === "student.profile.view"
        ? input.facts.student.id
        : input.facts.grade.id;
    log(
      "P13 server | FAKE ALLOW | " +
        input.capability +
        " | " +
        input.facts.principal.id +
        " -> " +
        target +
        " | " +
        input.requestId,
    );
    return "allow";
  };
}
