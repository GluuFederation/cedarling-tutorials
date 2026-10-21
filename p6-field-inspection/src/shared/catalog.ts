import type { Role } from "./types.ts";

export const tutorialUsers = [
  {
    id: "user-elena",
    subject: "elena",
    name: "Elena Rossi",
    role: "technician",
  },
  {
    id: "user-malik",
    subject: "malik",
    name: "Malik Johnson",
    role: "technician",
  },
  { id: "user-rowan", subject: "rowan", name: "Rowan Lee", role: "supervisor" },
] as const satisfies readonly {
  id: string;
  subject: string;
  name: string;
  role: Role;
}[];

export const technicians = tutorialUsers.filter(
  (user) => user.role === "technician",
);

export const checklistItems = [
  {
    key: "equipmentConditionPassed",
    label: "Equipment condition",
    help: "Check the equipment's visible condition and record any damage.",
  },
  {
    key: "safetyChecksPassed",
    label: "Safety checks",
    help: "Record the result of the safety checks required for this work order.",
  },
  {
    key: "functionalCheckPassed",
    label: "Functional check",
    help: "Record whether the equipment passed its permitted functional check.",
  },
] as const;

export const checklistKeys = checklistItems.map((item) => item.key);
