/** Builds P5 requests from trusted facts and calls the Cedarling SDK directly. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initFromArchiveBytes } from "@janssenproject/cedarling_wasm";
import { unzipSync } from "fflate";
import type { Analyst, DatasetField, QueryPlan } from "../shared/contracts.ts";
import type { ExportRecord } from "./database.ts";
import { AuthorizationError } from "./errors.ts";
import { datasetFields } from "./query.ts";

const actions = {
  "data.query": "Query",
  "data.aggregate": "Aggregate",
  "data.export": "CreateExport",
  "export.revoke": "RevokeExport",
  "export.download": "DownloadExport",
} as const;

export type AuthorizationRequest = {
  requestId: string;
  phase?: "preview" | "enforcement";
  analyst: Analyst;
} & (
  | {
      capability: "data.query" | "data.aggregate" | "data.export";
      plan: QueryPlan;
      minimumGroupSize?: number;
    }
  | { capability: "export.revoke" | "export.download"; export: ExportRecord }
);

export type DataAuthorization = {
  inspect(requestId: string, analyst: Analyst): Promise<DatasetField[]>;
  authorize(request: AuthorizationRequest): Promise<boolean>;
  close(): Promise<void>;
};

function principal(analyst: Analyst) {
  return {
    cedar_entity_mapping: {
      entity_type: "P5DataGuard::Analyst",
      id: analyst.id,
    },
    id: analyst.id,
    tenant_id: analyst.tenantId,
    role: analyst.role,
  };
}

/** Only an exact tenant equality in the submitted plan establishes this constraint. */
function planTenant(plan: QueryPlan): string | undefined {
  return plan.filter?.field === "tenantId" &&
    plan.filter.operator === "eq" &&
    typeof plan.filter.value === "string"
    ? plan.filter.value
    : undefined;
}

export async function createDataAuthorization(
  archivePath = resolve(".local/policy-store.cjar"),
): Promise<DataAuthorization> {
  const archive = new Uint8Array(await readFile(archivePath));
  const entry = unzipSync(archive)["metadata.json"];
  if (!entry) throw new Error("P5 policy archive has no metadata");
  const metadata = JSON.parse(new TextDecoder().decode(entry)) as {
    policy_store?: { version?: unknown };
  };
  if (typeof metadata.policy_store?.version !== "string")
    throw new Error("P5 policy archive has invalid metadata");
  console.info(
    `P5 Cedarling policy ${metadata.policy_store.version} | sha256 ${createHash("sha256").update(archive).digest("hex")}`,
  );
  const cedarling = await initFromArchiveBytes(
    {
      CEDARLING_APPLICATION_NAME: "P5 DataGuard",
      CEDARLING_LOG_TYPE: "memory",
      CEDARLING_LOG_TTL: 300,
      CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
    },
    archive,
  );

  // Keep application correlation separate from unmodified Cedarling evidence.
  function logDecision(
    requestId: string,
    actorId: string,
    capability: string,
    phase: "preview" | "enforcement",
    resource: { entity_type: string; id: string },
    cedarlingRequestId: string,
  ) {
    console.info(
      JSON.stringify(
        {
          event: "authorization.context",
          requestId,
          actorId,
          capability,
          phase,
          resource,
          cedarlingRequestId,
        },
        null,
        2,
      ),
    );
    for (const log of cedarling.getLogsByRequestId(cedarlingRequestId)) {
      console.info(JSON.stringify(log, null, 2));
    }
  }

  function logFailure(
    requestId: string,
    actorId: string,
    capability: string,
    phase: "preview" | "enforcement",
  ) {
    console.error(
      JSON.stringify(
        {
          event: "authorization.failed",
          requestId,
          actorId,
          capability,
          phase,
          category: "authorization_unavailable",
        },
        null,
        2,
      ),
    );
  }

  return {
    async inspect(requestId, analyst) {
      try {
        const batch = await cedarling.authorizeUnsignedBatch(
          JSON.stringify({
            principal: principal(analyst),
            items: datasetFields.map((field) => ({
              action: 'P5DataGuard::Action::"InspectDataset"',
              resource: {
                cedar_entity_mapping: {
                  entity_type: "P5DataGuard::Field",
                  id: field.name,
                },
                name: field.name,
                classification: field.classification,
              },
              context: {},
            })),
          }),
        );
        if (batch.results.length !== datasetFields.length)
          throw new Error("Incomplete field decisions");
        const allowed: DatasetField[] = [];
        for (const [index, item] of batch.results.entries()) {
          if (!item.is_ok) throw new Error("Field evaluation failed");
          const result = item.unwrap();
          const field = datasetFields[index];
          if (!field) throw new Error("Unexpected field decision");
          logDecision(
            requestId,
            analyst.id,
            "dataset.inspect",
            "enforcement",
            {
              entity_type: "P5DataGuard::Field",
              id: field.name,
            },
            result.request_id,
          );
          if (result.response.diagnostics.errors.length)
            throw new Error("Field policy error");
          if (result.decision === true) allowed.push(field);
        }
        return allowed;
      } catch {
        logFailure(requestId, analyst.id, "dataset.inspect", "enforcement");
        throw new AuthorizationError(503, "authorization_unavailable");
      }
    },
    async authorize(request) {
      const { analyst, capability, requestId } = request;
      let resource: {
        cedar_entity_mapping: { entity_type: string; id: string };
      } & Record<string, unknown>;
      let context = {};
      if ("plan" in request) {
        const { plan } = request;
        const names = new Set([
          ...(plan.kind === "rows"
            ? plan.fields
            : [
                ...(plan.field ? [plan.field] : []),
                ...(plan.groupBy ? [plan.groupBy] : []),
              ]),
          ...(plan.filter ? [plan.filter.field] : []),
        ]);
        const tenant = planTenant(plan);
        resource = {
          cedar_entity_mapping: {
            entity_type: "P5DataGuard::Dataset",
            id: "workforce",
          },
        };
        context = {
          kind: plan.kind,
          purpose: plan.purpose,
          ...(tenant !== undefined ? { tenant_id: tenant } : {}),
          field_names: [...names],
          classifications: [
            ...new Set(
              datasetFields
                .filter((field) => names.has(field.name))
                .map((field) => field.classification),
            ),
          ],
          ...(request.minimumGroupSize !== undefined
            ? { minimum_group_size: request.minimumGroupSize }
            : {}),
        };
      } else {
        resource = {
          cedar_entity_mapping: {
            entity_type: "P5DataGuard::Export",
            id: request.export.id,
          },
          owner_id: request.export.ownerId,
          tenant_id: planTenant(request.export.plan) ?? "",
          purpose: request.export.purpose,
        };
      }
      try {
        const result = await cedarling.authorizeUnsigned(
          JSON.stringify({
            principal: principal(analyst),
            action: `P5DataGuard::Action::"${actions[capability]}"`,
            resource,
            context,
          }),
        );
        logDecision(
          requestId,
          analyst.id,
          capability,
          request.phase ?? "enforcement",
          resource.cedar_entity_mapping,
          result.request_id,
        );
        if (result.response.diagnostics.errors.length)
          throw new Error("Policy evaluation failed");
        return result.decision === true;
      } catch {
        logFailure(
          requestId,
          analyst.id,
          capability,
          request.phase ?? "enforcement",
        );
        throw new AuthorizationError(503, "authorization_unavailable");
      }
    },
    close: () => cedarling.shutDown(),
  };
}
