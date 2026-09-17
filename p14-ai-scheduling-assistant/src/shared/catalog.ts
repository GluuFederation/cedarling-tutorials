import type { User } from "./types.ts";

export const tutorialUsers = [
  {
    id: "user-dina",
    subject: "dina",
    name: "Dina",
    role: "Project lead",
    kind: "employee",
  },
  {
    id: "user-amara",
    subject: "amara",
    name: "Amara",
    role: "Scheduling coordinator",
    kind: "employee",
  },
  {
    id: "user-benoit",
    subject: "benoit",
    name: "Benoit",
    role: "Team member",
    kind: "employee",
  },
  {
    id: "user-chloe",
    subject: "chloe",
    name: "Chloe",
    role: "External contractor",
    kind: "contractor",
  },
] as const satisfies readonly (User & { subject: string })[];

export const loginHints: ReadonlySet<string> = new Set(
  tutorialUsers.map((user) => user.subject),
);
