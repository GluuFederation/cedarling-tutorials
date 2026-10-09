import {
  initFromArchiveBytes,
  type Cedarling,
} from "@janssenproject/cedarling_wasm";
import {
  actionIds,
  capabilities,
  type AssignmentTarget,
  type AuthorizationEnvelope,
  type TaskCeiling,
  type TaskControl,
} from "../shared/authorization";
import type { Task, User } from "./types";

type ActivePolicy = Readonly<{
  digest: string;
  cedarling: Cedarling;
}>;

type MutableCeiling = {
  tenant?: { create: boolean };
  tasks: Record<string, TaskCeiling>;
};

type PresentationAuthorization = Readonly<{
  ceiling: AuthorizationEnvelope["ceiling"];
  stale: boolean;
}>;

let active: ActivePolicy | undefined;
let pending:
  Readonly<{ digest: string; promise: Promise<ActivePolicy> }> | undefined;

function copyCeiling(
  ceiling: AuthorizationEnvelope["ceiling"],
): MutableCeiling {
  return {
    ...(ceiling.tenant ? { tenant: { create: ceiling.tenant.create } } : {}),
    tasks: Object.fromEntries(
      Object.entries(ceiling.tasks).map(([id, controls]) => [
        id,
        { ...controls },
      ]),
    ),
  };
}

function emptyCeiling(): AuthorizationEnvelope["ceiling"] {
  return { tasks: {} };
}

function hexadecimal(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function loadPolicy(
  policy: AuthorizationEnvelope["policy"],
): Promise<ActivePolicy> {
  if (active?.digest === policy.sha256) return active;
  if (pending?.digest === policy.sha256) return pending.promise;
  if (pending !== undefined) {
    try {
      await pending.promise;
    } catch {
      // The requested digest still gets its own initialization attempt.
    }
    return loadPolicy(policy);
  }
  if (!/^[a-f0-9]{64}$/.test(policy.sha256))
    throw new Error("Policy store digest is invalid");
  const expectedPath = `/policy-store/${policy.sha256}.cjar`;
  const policyUrl = new URL(policy.url, location.href);
  if (
    policyUrl.origin !== location.origin ||
    policyUrl.pathname !== expectedPath
  )
    throw new Error("Policy store URL is not the expected same-origin URL");

  const promise = (async () => {
    const response = await fetch(expectedPath, {
      cache: "force-cache",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Policy store is unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = hexadecimal(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    );
    if (digest !== policy.sha256)
      throw new Error("Policy store digest does not match the envelope");
    const cedarling = await initFromArchiveBytes(
      {
        CEDARLING_APPLICATION_NAME: "P1 Task Manager browser",
        CEDARLING_LOG_TYPE: "memory",
        CEDARLING_LOG_TTL: 300,
        // Browser requests use server-projected entities, not JWTs.
        CEDARLING_JWT_SIG_VALIDATION: "disabled",
        CEDARLING_JWT_STATUS_VALIDATION: "disabled",
        CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
      },
      bytes,
    );
    const previous = active;
    active = { digest, cedarling };
    if (previous !== undefined) {
      await previous.cedarling.shutDown();
    }
    return active;
  })();
  pending = { digest: policy.sha256, promise };
  try {
    return await promise;
  } finally {
    if (pending.promise === promise) pending = undefined;
  }
}

function isCurrent(
  envelope: AuthorizationEnvelope,
  tasks: readonly Task[],
  user: User,
  expectedSubjectEpoch?: string,
): boolean {
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (
    expectedSubjectEpoch !== undefined &&
    envelope.subjectEpoch !== expectedSubjectEpoch
  )
    return false;
  if (
    envelope.uiPrincipal.id !== user.id ||
    envelope.uiPrincipal.tenantId !== user.tenantId ||
    envelope.uiPrincipal.role !== user.role ||
    envelope.uiPrincipal.assuranceLevel !== user.assuranceLevel
  )
    return false;
  return tasks.every(
    (task) => envelope.resourceVersions[task.id] === task.version,
  );
}

export async function authorizePresentation(
  options: Readonly<{
    envelope: AuthorizationEnvelope;
    tasks: readonly Task[];
    user: User;
    assignmentTarget?: AssignmentTarget;
    expectedSubjectEpoch?: string;
  }>,
): Promise<PresentationAuthorization> {
  const { envelope, tasks, user } = options;
  if (!isCurrent(envelope, tasks, user, options.expectedSubjectEpoch))
    return { ceiling: emptyCeiling(), stale: true };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const items: object[] = [];
  const destinations: Array<
    { kind: "tenant" } | { kind: "task"; id: string; control: TaskControl }
  > = [];
  if (envelope.ceiling.tenant?.create) {
    items.push({
      action: actionIds[capabilities.create],
      resource: {
        cedar_entity_mapping: {
          entity_type: "Task::Tenant",
          id: user.tenantId,
        },
        tenant_id: user.tenantId,
      },
      context: { boundary: "browser" },
    });
    destinations.push({ kind: "tenant" });
  }
  for (const [id, controls] of Object.entries(envelope.ceiling.tasks)) {
    const task = byId.get(id);
    if (task === undefined) return { ceiling: emptyCeiling(), stale: true };
    for (const control of Object.keys(controls) as TaskControl[]) {
      if (!controls[control]) continue;
      items.push({
        action: actionIds[capabilities[control]],
        resource: {
          cedar_entity_mapping: {
            entity_type: "Task::Task",
            id: task.id,
          },
          tenant_id: task.tenantId,
          owner_id: task.ownerId,
          ...(task.assigneeId === null ? {} : { assignee_id: task.assigneeId }),
        },
        context: {
          boundary: "browser",
          ...(control === "assign" && options.assignmentTarget
            ? {
                requested_assignee_tenant_id: options.assignmentTarget.tenantId,
              }
            : {}),
        },
      });
      destinations.push({ kind: "task", id, control });
    }
  }

  if (items.length === 0)
    return { ceiling: copyCeiling(envelope.ceiling), stale: false };

  try {
    const { cedarling } = await loadPolicy(envelope.policy);
    if (!isCurrent(envelope, tasks, user, options.expectedSubjectEpoch))
      return { ceiling: emptyCeiling(), stale: true };
    const batch = await cedarling.authorizeUnsignedBatch(
      JSON.stringify({
        principal: {
          cedar_entity_mapping: {
            entity_type: "Task::User",
            id: user.id,
          },
          id: user.id,
          tenant_id: user.tenantId,
          role: user.role,
          assurance_level: user.assuranceLevel,
        },
        items,
      }),
    );
    if (batch.results.length !== destinations.length)
      throw new Error("Cedarling returned an incomplete browser batch");
    const ceiling = copyCeiling(envelope.ceiling);
    for (const [index, item] of batch.results.entries()) {
      if (!item.is_ok) throw new Error("Cedarling browser item failed");
      const result = item.unwrap();
      for (const log of cedarling.getLogsByRequestId(result.request_id)) {
        const entry = log as Record<string, unknown>;
        const action =
          typeof entry.action === "string" ? entry.action : "authorization";
        console.info(
          `P1 browser | ${result.decision ? "ALLOW" : "DENY"} | ${action}`,
          log,
        );
      }
      if (result.response.diagnostics.errors.length > 0)
        throw new Error("Cedarling returned policy evaluation errors");
      const destination = destinations[index];
      if (destination?.kind === "tenant" && ceiling.tenant) {
        ceiling.tenant.create = ceiling.tenant.create && result.decision;
      } else if (destination?.kind === "task") {
        const controls = ceiling.tasks[destination.id];
        if (controls)
          controls[destination.control] =
            Boolean(controls[destination.control]) && result.decision;
      }
    }
    if (!isCurrent(envelope, tasks, user, options.expectedSubjectEpoch))
      return { ceiling: emptyCeiling(), stale: true };
    return { ceiling, stale: false };
  } catch {
    if (!isCurrent(envelope, tasks, user, options.expectedSubjectEpoch))
      return { ceiling: emptyCeiling(), stale: true };
    console.warn(
      "P1 browser | authorization unavailable; using the current server ceiling",
    );
    return { ceiling: copyCeiling(envelope.ceiling), stale: false };
  }
}

export async function closeBrowserAuthorization(): Promise<void> {
  try {
    await pending?.promise;
  } catch {
    // Failed initialization has no retained instance to close.
  }
  const current = active;
  active = undefined;
  if (current !== undefined) {
    await current.cedarling.shutDown();
  }
}
