import type { Capability } from "./capabilities.ts";

export type Role = "technician" | "supervisor";
type WorkOrderStatus =
  | "open"
  | "awaiting_review"
  | "changes_requested"
  | "completed";

export type User = Readonly<{
  id: string;
  name: string;
  role: Role;
}>;

export type Checklist = Readonly<{
  equipmentConditionPassed: boolean;
  safetyChecksPassed: boolean;
  functionalCheckPassed: boolean;
}>;

export type WorkOrder = Readonly<{
  id: string;
  equipment: string;
  site: string;
  status: WorkOrderStatus;
  workOrderVersion: number;
  assigneeId: string;
  assigneeName: string;
  assignmentEpoch: number;
}>;

export type AuthorizationEnvelope = Readonly<{
  ceiling: Readonly<Partial<Record<Capability, boolean>>>;
  expiresAt: string;
}>;

export type WorkOrderDetail = WorkOrder &
  Readonly<{
    envelope: AuthorizationEnvelope;
    inspections: readonly Inspection[];
    assignmentHistory: readonly AssignmentChange[];
  }>;

export type AssignmentChange = Readonly<{
  previousAssignee: string;
  newAssignee: string;
  changedBy: string;
  changedAt: string;
  assignmentEpoch: number;
}>;

export type Inspection = Readonly<{
  id: string;
  workOrderId: string;
  submittedBy: string;
  checklist: Checklist;
  notes: string;
  createdAt: string;
  review?: Readonly<{
    reviewedBy: string;
    outcome: InspectionReview["outcome"];
    notes: string;
    createdAt: string;
  }>;
}>;

export type InspectionReview = Readonly<{
  inspectionId: string;
  expectedWorkOrderVersion: number;
  idempotencyKey: string;
  outcome: "complete" | "request_corrections";
  notes: string;
}>;

export type Session = Readonly<{
  user: User;
  csrfToken: string;
  expiresAt: string;
}>;

export type InspectionSubmission = Readonly<{
  idempotencyKey: string;
  expectedWorkOrderVersion: number;
  checklist: Checklist;
  notes: string;
}>;

export type Reassignment = Readonly<{
  expectedAssignmentEpoch: number;
  technicianId: string;
}>;

export type WorkOrderCreation = Readonly<{
  equipment: string;
  site: string;
  technicianId: string;
}>;

export type WorkOrderDeletion = Readonly<{
  expectedWorkOrderVersion: number;
  expectedAssignmentEpoch: number;
}>;
