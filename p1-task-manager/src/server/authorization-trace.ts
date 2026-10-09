import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { initFromArchiveBytes } from "@janssenproject/cedarling_wasm";
import { unzipSync } from "fflate";
import {
  actionIds,
  capabilities,
  type AuthorizationEnvelope,
  type Capability,
  type TaskCeiling,
} from "../shared/authorization.js";
import type { Session, Task } from "./database.js";

const archiveName = "policy-store.cjar";
const envelopeLifetimeMs = 60_000;
const digestPattern = /^[a-f0-9]{64}$/;

type ExistingTaskTarget = Readonly<{
  capability: Exclude<Capability, "task.create">;
  task: Task;
  requestedAssigneeTenantId?: string;
}>;

export type AuthorizationTarget =
  | ExistingTaskTarget
  | Readonly<{ capability: "task.create"; tenantId: string }>;

type PolicyMetadata = Readonly<{ id: string; version: string }>;

export type ServerAuthorization = Readonly<{
  authorize(
    requestId: string,
    session: Session,
    target: AuthorizationTarget,
  ): Promise<boolean>;
  authorizeBatch(
    requestId: string,
    session: Session,
    targets: readonly AuthorizationTarget[],
  ): Promise<boolean[]>;
  envelope(
    options: Readonly<{
      session: Session;
      tenantCreate?: boolean;
      taskCeilings?: Readonly<Record<string, TaskCeiling>>;
      tasks?: readonly Task[];
      now?: number;
    }>,
  ): AuthorizationEnvelope;
  artifact(digest: string): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
  readonly policy: AuthorizationEnvelope["policy"];
}>;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseMetadata(archive: Uint8Array): PolicyMetadata {
  const entry = unzipSync(archive)["metadata.json"];
  if (entry === undefined)
    throw new Error("P1 policy archive is missing metadata.json");
  const raw = JSON.parse(new TextDecoder().decode(entry)) as {
    policy_store?: { id?: unknown; version?: unknown };
  };
  const id = raw.policy_store?.id;
  const version = raw.policy_store?.version;
  if (typeof id !== "string" || typeof version !== "string")
    throw new Error("P1 policy archive metadata is invalid");
  return { id, version };
}

function requestItem(session: Session, target: AuthorizationTarget): object {
  return {
    action: actionIds[target.capability],
    resource:
      target.capability === capabilities.create
        ? {
            cedar_entity_mapping: {
              entity_type: "Task::Tenant",
              id: target.tenantId,
            },
            tenant_id: target.tenantId,
          }
        : {
            cedar_entity_mapping: {
              entity_type: "Task::Task",
              id: target.task.id,
            },
            tenant_id: target.task.tenantId,
            owner_id: target.task.ownerId,
            ...(target.task.assigneeId === null
              ? {}
              : { assignee_id: target.task.assigneeId }),
          },
    context: {
      boundary: "server",
      user: {
        id: session.user.id,
        subject: session.user.subject,
        tenant_id: session.user.tenantId,
        role: session.user.role,
        assurance_level: session.user.assuranceLevel,
      },
      ...(target.capability === capabilities.assign &&
      target.requestedAssigneeTenantId !== undefined
        ? {
            requested_assignee_tenant_id: target.requestedAssigneeTenantId,
          }
        : {}),
    },
  };
}

function tokenSet(session: Session): object[] {
  return [
    {
      mapping: "P1TaskManager::Access_token",
      payload: session.tokens.accessToken,
    },
  ];
}

async function registerArtifacts(
  archive: Uint8Array,
  digest: string,
  dataDirectory: string,
): Promise<{ directory: string; digests: Set<string> }> {
  const directory = path.join(dataDirectory, "policy-stores");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const currentPath = path.join(directory, `${digest}.cjar`);
  try {
    await writeFile(currentPath, archive, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (sha256(await readFile(currentPath)) !== digest)
      throw new Error("Stored P1 policy artifact does not match its digest", {
        cause: error,
      });
  }

  const digests = new Set<string>();
  for (const name of await readdir(directory)) {
    const candidate = name.replace(/\.cjar$/, "");
    if (!digestPattern.test(candidate)) continue;
    if (sha256(await readFile(path.join(directory, name))) === candidate)
      digests.add(candidate);
  }
  return { directory, digests };
}

export async function createServerAuthorization(
  options: Readonly<{
    projectRoot: string;
    dataDirectory: string;
  }>,
): Promise<ServerAuthorization> {
  const archive = new Uint8Array(
    await readFile(path.join(options.projectRoot, ".local", archiveName)),
  );
  const digest = sha256(archive);
  const metadata = parseMetadata(archive);
  const registry = await registerArtifacts(
    archive,
    digest,
    options.dataDirectory,
  );
  const cedarling = await initFromArchiveBytes(
    {
      CEDARLING_APPLICATION_NAME: "P1 Task Manager server",
      CEDARLING_LOG_TYPE: "memory",
      CEDARLING_LOG_TTL: 300,
      CEDARLING_JWT_SIG_VALIDATION: "enabled",
      CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED: ["RS256"],
      CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
      CEDARLING_TRUSTED_ISSUER_LOADER_TYPE: "SYNC",
    },
    archive,
  );
  if (cedarling.loadedTrustedIssuersCount() < 1) {
    await cedarling.shutDown();
    throw new Error("P1 requires at least one trusted issuer");
  }

  const policy = {
    release: `${metadata.id}@${metadata.version}`,
    storeId: metadata.id,
    version: metadata.version,
    sha256: digest,
    url: `/policy-store/${digest}.cjar`,
  } as const;

  async function authorize(
    requestId: string,
    session: Session,
    target: AuthorizationTarget,
  ): Promise<boolean> {
    try {
      const result = await cedarling.authorizeMultiIssuer(
        JSON.stringify({
          tokens: tokenSet(session),
          ...requestItem(session, target),
        }),
      );
      logDecision(requestId, session, target.capability, result.request_id);
      if (result.response.diagnostics.errors.length > 0)
        throw new Error("Cedarling returned policy evaluation errors");
      return result.decision;
    } catch (error) {
      logFailure(requestId, session, [target]);
      throw error;
    }
  }

  async function authorizeBatch(
    requestId: string,
    session: Session,
    targets: readonly AuthorizationTarget[],
  ): Promise<boolean[]> {
    if (targets.length === 0) return [];
    try {
      const batch = await cedarling.authorizeMultiIssuerBatch(
        JSON.stringify({
          tokens: tokenSet(session),
          items: targets.map((target) => requestItem(session, target)),
        }),
      );
      const decisions: boolean[] = [];
      for (const [index, item] of batch.results.entries()) {
        if (!item.is_ok) {
          const failure = item.error;
          throw new Error(
            failure === undefined
              ? "Cedarling batch item failed"
              : `Cedarling batch item failed: ${failure.category}`,
          );
        }
        const result = item.unwrap();
        const target = targets[index];
        if (!target)
          throw new Error("Cedarling returned an unexpected batch item");
        logDecision(requestId, session, target.capability, result.request_id);
        if (result.response.diagnostics.errors.length > 0)
          throw new Error("Cedarling returned policy evaluation errors");
        decisions.push(result.decision);
      }
      return decisions;
    } catch (error) {
      logFailure(requestId, session, targets);
      throw error;
    }
  }

  // Link application requests to unmodified Cedarling decision evidence.
  function logDecision(
    requestId: string,
    session: Session,
    capability: Capability,
    cedarlingRequestId: string,
  ): void {
    console.info(
      JSON.stringify(
        {
          event: "authorization.context",
          requestId,
          actorId: session.user.id,
          capability,
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
    session: Session,
    targets: readonly AuthorizationTarget[],
  ): void {
    // SDK exceptions can contain request data; only log controlled metadata here.
    console.error(
      JSON.stringify(
        {
          event: "authorization.failed",
          requestId,
          actorId: session.user.id,
          capabilities: [
            ...new Set(targets.map((target) => target.capability)),
          ],
          category: "authorization_unavailable",
        },
        null,
        2,
      ),
    );
  }

  return {
    policy,
    authorize,
    authorizeBatch,
    envelope({
      session,
      tenantCreate,
      taskCeilings = {},
      tasks = [],
      now = Date.now(),
    }): AuthorizationEnvelope {
      const expiresAt = Math.min(now + envelopeLifetimeMs, session.expiresAt);
      return {
        uiPrincipal: {
          id: session.user.id,
          tenantId: session.user.tenantId,
          role: session.user.role,
          assuranceLevel: session.user.assuranceLevel,
        },
        ceiling: {
          ...(tenantCreate === undefined
            ? {}
            : { tenant: { create: tenantCreate } }),
          tasks: taskCeilings,
        },
        policy,
        subjectEpoch: sha256(
          JSON.stringify({
            id: session.user.id,
            tenantId: session.user.tenantId,
            role: session.user.role,
            assuranceLevel: session.user.assuranceLevel,
            expiresAt: session.expiresAt,
          }),
        ),
        resourceVersions: Object.fromEntries(
          tasks.map((task) => [task.id, task.version]),
        ),
        evaluatedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },
    async artifact(requestedDigest) {
      if (!registry.digests.has(requestedDigest)) return undefined;
      return new Uint8Array(
        await readFile(
          path.join(registry.directory, `${requestedDigest}.cjar`),
        ),
      );
    },
    async close() {
      await cedarling.shutDown();
    },
  };
}
