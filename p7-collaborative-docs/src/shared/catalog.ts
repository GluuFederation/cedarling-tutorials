import type { User } from "./types.ts";

export const tutorialUsers = [
  { id: "user-maya", subject: "maya", name: "Maya Chen" },
  { id: "user-noah", subject: "noah", name: "Noah Williams" },
  { id: "user-lena", subject: "lena", name: "Lena Ortiz" },
] as const satisfies readonly (User & { subject: string })[];

export const loginHints: ReadonlySet<string> = new Set(
  tutorialUsers.map((user) => user.subject),
);
