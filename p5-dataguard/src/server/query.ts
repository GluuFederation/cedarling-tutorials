import { z } from "zod";
import {
  type DatasetField,
  type FieldName,
  fieldNames,
  type QueryPlan,
} from "../shared/contracts.ts";

export const datasetFields: readonly DatasetField[] = [
  {
    name: "employeeId",
    label: "Employee ID",
    type: "text",
    classification: "operational",
  },
  { name: "fullName", label: "Name", type: "text", classification: "personal" },
  {
    name: "workEmail",
    label: "Work email",
    type: "text",
    classification: "personal",
  },
  {
    name: "department",
    label: "Department",
    type: "text",
    classification: "operational",
  },
  {
    name: "location",
    label: "Location",
    type: "text",
    classification: "operational",
  },
  {
    name: "supportTier",
    label: "Support tier",
    type: "text",
    classification: "operational",
  },
  {
    name: "employmentStatus",
    label: "Status",
    type: "text",
    classification: "operational",
  },
  {
    name: "salary",
    label: "Salary",
    type: "number",
    classification: "compensation",
  },
  {
    name: "bonus",
    label: "Bonus",
    type: "number",
    classification: "compensation",
  },
  { name: "tenantId", label: "Tenant", type: "text", classification: "tenant" },
] as const;

const fieldSchema = z.enum(fieldNames);
const purposeSchema = z.enum(["support", "finance-review", "external-audit"]);
const filterSchema = z
  .object({
    field: fieldSchema,
    operator: z.enum(["eq", "contains", "gte", "lte"]),
    value: z.union([z.string().min(1).max(160), z.number().finite()]),
  })
  .strict()
  .superRefine((filter, context) => {
    const metadata = datasetFields.find((field) => field.name === filter.field);
    if (!metadata) return;
    if (metadata.type === "number" && typeof filter.value !== "number") {
      context.addIssue({
        code: "custom",
        message: "Numeric filters require a number",
        path: ["value"],
      });
    }
    if (metadata.type === "text" && typeof filter.value !== "string") {
      context.addIssue({
        code: "custom",
        message: "Text filters require a string",
        path: ["value"],
      });
    }
    if (filter.operator === "contains" && metadata.type !== "text") {
      context.addIssue({
        code: "custom",
        message: "contains applies only to text",
        path: ["operator"],
      });
    }
    if (
      (filter.operator === "gte" || filter.operator === "lte") &&
      metadata.type !== "number"
    ) {
      context.addIssue({
        code: "custom",
        message: "range filters apply only to numbers",
        path: ["operator"],
      });
    }
  });

const common = {
  filter: filterSchema.optional(),
  purpose: purposeSchema,
  limit: z.number().int().min(1).max(50),
};

const rowPlanSchema = z
  .object({
    kind: z.literal("rows"),
    fields: z.array(fieldSchema).min(1).max(fieldNames.length),
    ...common,
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.fields).size !== plan.fields.length) {
      context.addIssue({
        code: "custom",
        message: "Fields must be unique",
        path: ["fields"],
      });
    }
  });

const aggregatePlanSchema = z
  .object({
    kind: z.literal("aggregate"),
    operation: z.enum(["count", "average"]),
    field: z.enum(["salary", "bonus"]).optional(),
    groupBy: fieldSchema.optional(),
    ...common,
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.operation === "average" && !plan.field) {
      context.addIssue({
        code: "custom",
        message: "average requires a numeric field",
        path: ["field"],
      });
    }
    if (plan.operation === "count" && plan.field) {
      context.addIssue({
        code: "custom",
        message: "count does not accept a field",
        path: ["field"],
      });
    }
  });

export const queryPlanSchema = z.discriminatedUnion("kind", [
  rowPlanSchema,
  aggregatePlanSchema,
]);

const columns: Readonly<Record<FieldName, string>> = {
  employeeId: "employee_id",
  fullName: "full_name",
  workEmail: "work_email",
  department: "department",
  location: "location",
  supportTier: "support_tier",
  employmentStatus: "employment_status",
  salary: "salary",
  bonus: "bonus",
  tenantId: "tenant_id",
};

type Binding = string | number;
export type CompiledQuery = Readonly<{
  sql: string;
  bindings: Binding[];
  outputColumns: string[];
}>;

function identifier(field: FieldName): string {
  // The map is the only path from a client field name to a SQL identifier.
  return `"${columns[field]}"`;
}

function filterClause(plan: QueryPlan): { sql: string; bindings: Binding[] } {
  if (!plan.filter) return { sql: "", bindings: [] };
  const { field, operator, value } = plan.filter;
  const column = identifier(field);
  if (operator === "contains") {
    return {
      sql: ` WHERE instr(lower(${column}), lower(?)) > 0`,
      bindings: [value],
    };
  }
  const sqlOperator =
    operator === "eq" ? "=" : operator === "gte" ? ">=" : "<=";
  return { sql: ` WHERE ${column} ${sqlOperator} ?`, bindings: [value] };
}

export function compileQuery(plan: QueryPlan): CompiledQuery {
  const filter = filterClause(plan);
  if (plan.kind === "rows") {
    const selections = plan.fields.map(
      (field) => `${identifier(field)} AS "${field}"`,
    );
    return {
      sql: `SELECT ${selections.join(", ")} FROM workforce${filter.sql} ORDER BY employee_id LIMIT ?`,
      bindings: [...filter.bindings, plan.limit],
      outputColumns: [...plan.fields],
    };
  }

  const group = plan.groupBy;
  let aggregate: string;
  if (plan.operation === "count") {
    aggregate = 'COUNT(*) AS "count"';
  } else {
    if (!plan.field) {
      throw new Error("An average query requires a numeric field");
    }
    aggregate = `ROUND(AVG(${identifier(plan.field)}), 2) AS "average"`;
  }
  const selections = group
    ? [`${identifier(group)} AS "${group}"`, aggregate]
    : [aggregate];
  const groupSql = group
    ? ` GROUP BY ${identifier(group)} ORDER BY ${identifier(group)}`
    : "";
  return {
    sql: `SELECT ${selections.join(", ")} FROM workforce${filter.sql}${groupSql} LIMIT ?`,
    bindings: [...filter.bindings, plan.limit],
    outputColumns: group ? [group, plan.operation] : [plan.operation],
  };
}

export function compileCardinalityQuery(plan: QueryPlan): CompiledQuery {
  const filter = filterClause(plan);
  const group = plan.kind === "aggregate" ? plan.groupBy : undefined;
  return {
    sql: group
      ? `SELECT COUNT(*) AS "groupSize" FROM workforce${filter.sql} GROUP BY ${identifier(group)} ORDER BY ${identifier(group)} LIMIT ?`
      : `SELECT COUNT(*) AS "groupSize" FROM workforce${filter.sql}`,
    bindings: group ? [...filter.bindings, plan.limit] : filter.bindings,
    outputColumns: ["groupSize"],
  };
}
