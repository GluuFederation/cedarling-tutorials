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
  { key: "safetyGuardSecured", label: "Safety guard secured" },
  { key: "fluidLevelChecked", label: "Fluid level checked" },
  {
    key: "operatingTemperatureRecorded",
    label: "Operating temperature recorded",
  },
] as const;

export const checklistKeys = checklistItems.map((item) => item.key);
