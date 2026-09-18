import type { Authorize } from "./school.ts";

export function createAuthorization(
  log: (line: string) => void = console.info,
): Authorize {
  return async ({ capability, facts }) => {
    log(
      `P13 server | FAKE ALLOW | ${capability} | ${facts.principal.id} -> Grade::${facts.grade.id}`,
    );
    return "allow";
  };
}
