export const fieldNames = [
  "employeeId",
  "fullName",
  "workEmail",
  "department",
  "location",
  "supportTier",
  "employmentStatus",
  "salary",
  "bonus",
  "tenantId",
] as const;

export type FieldName = (typeof fieldNames)[number];
export type Purpose = "support" | "finance-review" | "external-audit";
export type FilterOperator = "eq" | "contains" | "gte" | "lte";

export type Filter = Readonly<{
  field: FieldName;
  operator: FilterOperator;
  value: string | number;
}>;

export type RowPlan = Readonly<{
  kind: "rows";
  fields: FieldName[];
  filter?: Filter | undefined;
  purpose: Purpose;
  limit: number;
}>;

export type AggregatePlan = Readonly<{
  kind: "aggregate";
  operation: "count" | "average";
  field?: "salary" | "bonus" | undefined;
  groupBy?: FieldName | undefined;
  filter?: Filter | undefined;
  purpose: Purpose;
  limit: number;
}>;

export type QueryPlan = RowPlan | AggregatePlan;

export type DatasetField = Readonly<{
  name: FieldName;
  label: string;
  type: "text" | "number";
  classification: "operational" | "personal" | "compensation" | "tenant";
}>;

export type Analyst = Readonly<{
  id: string;
  name: string;
  tenantId: string;
  role: string;
}>;

export type SessionResponse = Readonly<{
  user: Analyst;
  csrfToken: string;
  expiresAt: string;
}>;

export type QueryResponse = Readonly<{
  requestId: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}>;

export type ExportState = "ready" | "expired" | "revoked";
export type ExportSummary = Readonly<{
  id: string;
  ownerId: string;
  purpose: Purpose;
  state: ExportState;
  createdAt: string;
  expiresAt: string;
  rowCount: number;
}>;

export type ExportCreated = Readonly<{
  export: ExportSummary;
  downloadRef: string;
}>;
