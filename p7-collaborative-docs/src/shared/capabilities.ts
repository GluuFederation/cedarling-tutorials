export const capabilities = {
  create: "document.create",
  read: "document.read",
  edit: "document.edit",
  comment: "comment.create",
  manageAccess: "access.manage",
  observe: "document.observe",
} as const;

export type Capability = (typeof capabilities)[keyof typeof capabilities];
