export const capabilities = {
  view: "task.view",
  create: "task.create",
  edit: "task.edit",
  assign: "task.assign",
  complete: "task.complete",
  delete: "task.delete",
} as const;

export type Capability = (typeof capabilities)[keyof typeof capabilities];
export const actionIds: Readonly<Record<Capability, string>> = {
  [capabilities.view]: 'Task::Action::"View"',
  [capabilities.create]: 'Task::Action::"Create"',
  [capabilities.edit]: 'Task::Action::"Edit"',
  [capabilities.assign]: 'Task::Action::"Assign"',
  [capabilities.complete]: 'Task::Action::"Complete"',
  [capabilities.delete]: 'Task::Action::"Delete"',
};
export type TaskControl = Exclude<keyof typeof capabilities, "create">;

export type TaskCeiling = Partial<Record<TaskControl, boolean>>;

export type AuthorizationEnvelope = Readonly<{
  uiPrincipal: Readonly<{
    id: string;
    tenantId: string;
    role: string;
    assuranceLevel: number;
  }>;
  ceiling: Readonly<{
    tenant?: Readonly<{ create: boolean }>;
    tasks: Readonly<Record<string, TaskCeiling>>;
  }>;
  policy: Readonly<{
    release: string;
    storeId: string;
    version: string;
    sha256: string;
    url: string;
  }>;
  subjectEpoch: string;
  resourceVersions: Readonly<Record<string, number>>;
  evaluatedAt: string;
  expiresAt: string;
}>;

export type AssignmentTarget = Readonly<{
  id: string;
  name: string;
  tenantId: string;
}>;
