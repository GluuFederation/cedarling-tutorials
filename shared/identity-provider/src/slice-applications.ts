/** Shared defaults for the P12–P15 registrations and local setup. */
export const sliceApplications = [
  {
    prefix: "P12",
    id: "p12-hr-access-governance",
    name: "P12 CedarHR",
    port: 3012,
    scope: "hr.access",
  },
  {
    prefix: "P13",
    id: "p13-student-records",
    name: "P13 CedarSchool",
    port: 3013,
    scope: "grade.access",
  },
  {
    prefix: "P14",
    id: "p14-ai-scheduling-assistant",
    name: "P14 CedarSchedule",
    port: 3014,
    scope: "schedule.access",
  },
  {
    prefix: "P15",
    id: "p15-marketplace",
    name: "P15 CedarMarket",
    port: 3015,
    scope: "refund.access",
  },
] as const;
