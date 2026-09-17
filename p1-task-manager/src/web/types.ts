export type User = {
  id: string;
  name: string;
  tenantId: string;
  role: "contributor" | "owner" | "external";
  assuranceLevel: number;
};

export type Task = {
  id: string;
  tenantId: string;
  ownerId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "completed";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Session = { user: User; csrfToken: string; expiresAt: string };

export type TaskResult = { task: Task };
