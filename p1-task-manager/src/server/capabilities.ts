export const capabilities = {
  view: "task.view",
  create: "task.create",
  edit: "task.edit",
  assign: "task.assign",
  complete: "task.complete",
  delete: "task.delete",
} as const;

export type Capability = (typeof capabilities)[keyof typeof capabilities];
