/** Registration identities and localhost endpoints for independently run tutorials. */
export const projects = [
  { number: 1, id: "p1-task-manager", name: "P1 Task Manager" },
  { number: 2, id: "p2-tenantrag", name: "P2 TenantRAG" },
  {
    number: 3,
    id: "p3-mcp-capability-governance",
    name: "P3 Incident Assistant",
  },
  { number: 4, id: "p4-editorial-publishing", name: "P4 CedarPress" },
  { number: 5, id: "p5-dataguard", name: "P5 DataGuard" },
  { number: 6, id: "p6-field-inspection", name: "P6 CedarInspect" },
  { number: 7, id: "p7-collaborative-docs", name: "P7 CedarDocs" },
  { number: 8, id: "p8-cedarfile", name: "P8 CedarFile" },
  { number: 9, id: "p9-cedarrealtime", name: "P9 CedarRealtime" },
  {
    number: 10,
    id: "p10-warehouse-workloads",
    name: "P10 Warehouse Workloads",
  },
  { number: 11, id: "p11-saas-workspace", name: "P11 SaaS Workspace" },
  { number: 12, id: "p12-hr-access-governance", name: "P12 CedarHR" },
  { number: 13, id: "p13-student-records", name: "P13 CedarSchool" },
  { number: 14, id: "p14-ai-scheduling-assistant", name: "P14 CedarSchedule" },
  { number: 15, id: "p15-marketplace", name: "P15 CedarMarket" },
] as const;

export const workloads = [
  {
    id: "p10-transfer-planner",
    prefix: "P10_TRANSFER_PLANNER",
    name: "P10 Transfer Planner",
  },
  {
    id: "p10-warehouse-north",
    prefix: "P10_WAREHOUSE_NORTH",
    name: "P10 North Warehouse",
  },
  {
    id: "p10-warehouse-south",
    prefix: "P10_WAREHOUSE_SOUTH",
    name: "P10 South Warehouse",
  },
  {
    id: "p10-inventory-auditor",
    prefix: "P10_INVENTORY_AUDITOR",
    name: "P10 Inventory Auditor",
  },
] as const;

export function projectSettings(selector: string | undefined) {
  const project = projects.find(({ number }) => selector === `P${number}`);
  if (!project) throw new Error("IDP_PROJECT must select P1 through P15");
  return {
    ...project,
    prefix: `P${project.number}`,
    port: 17000 + project.number,
    idpPort: 18000 + project.number,
    origin: `http://localhost:${17000 + project.number}`,
    issuer: `http://localhost:${18000 + project.number}`,
    device: project.number === 2 || project.number === 3,
  };
}
