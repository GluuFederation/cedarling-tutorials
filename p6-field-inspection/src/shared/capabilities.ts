export const capabilities = {
  read: "workorder.read",
  create: "workorder.create",
  delete: "workorder.delete",
  submit: "inspection.submit",
  review: "inspection.review",
  reassign: "workorder.reassign",
} as const;

export type Capability = (typeof capabilities)[keyof typeof capabilities];
