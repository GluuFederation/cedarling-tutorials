import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initFromArchiveBytes,
  type Cedarling,
} from "@janssenproject/cedarling_wasm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { createServerAuthorization } from "../src/server/authorization-trace.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const policyStoreSource = join(projectRoot, "policy-store");
const audience = "http://localhost:17001/api";
const allScopes = [
  "task.view",
  "task.create",
  "task.edit",
  "task.assign",
  "task.complete",
  "task.delete",
] as const;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: "jwk" });

let cedarling: Cedarling | undefined;
let issuer = "";
let issuerServer: Server | undefined;
let temporaryRoot = "";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken(
  subject: string,
  scopes: readonly string[] | null = allScopes,
  tokenAudience = audience,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", kid: "p1-test-key", typ: "at+jwt" });
  const payload = encode({
    iss: issuer,
    sub: subject,
    aud: tokenAudience,
    jti: randomUUID(),
    iat: now,
    exp: now + 300,
    scope: scopes?.join(" "),
  });
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    privateKey,
  ).toString("base64url")}`;
}

function userContext(
  id: string,
  subject: string,
  tenantId: string,
  role: string,
  assuranceLevel: number,
) {
  return {
    id,
    subject,
    tenant_id: tenantId,
    role,
    assurance_level: assuranceLevel,
  };
}

function task(
  id: string,
  tenantId: string,
  ownerId: string,
  assigneeId: string,
) {
  return {
    cedar_entity_mapping: { entity_type: "Task::Task", id },
    tenant_id: tenantId,
    owner_id: ownerId,
    assignee_id: assigneeId,
  };
}

function tenant(tenantId: string) {
  return {
    cedar_entity_mapping: {
      entity_type: "Task::Tenant",
      id: tenantId,
    },
    tenant_id: tenantId,
  };
}

function principal(
  id: string,
  tenantId: string,
  role: string,
  assuranceLevel: number,
) {
  return {
    cedar_entity_mapping: { entity_type: "Task::User", id },
    id,
    tenant_id: tenantId,
    role,
    assurance_level: assuranceLevel,
  };
}

function action(name: string): string {
  return `Task::Action::"${name}"`;
}

function tokenSet(
  subject: string,
  scopes: readonly string[] = allScopes,
  tokenAudience = audience,
) {
  return [
    {
      mapping: "P1TaskManager::Access_token",
      payload: accessToken(subject, scopes, tokenAudience),
    },
  ];
}

function signedRequest({
  subject,
  user,
  action: requestAction,
  resource,
  context = {},
  scopes = allScopes,
  tokenAudience = audience,
}: {
  subject: string;
  user: ReturnType<typeof userContext>;
  action: string;
  resource: object;
  context?: object;
  scopes?: readonly string[];
  tokenAudience?: string;
}) {
  return {
    tokens: tokenSet(subject, scopes, tokenAudience),
    action: action(requestAction),
    resource,
    context: { boundary: "server", user, ...context },
  };
}

function browserRequest({
  principal: requestPrincipal,
  action: requestAction,
  resource,
  context = {},
}: {
  principal: ReturnType<typeof principal>;
  action: string;
  resource: object;
  context?: object;
}) {
  return {
    principal: requestPrincipal,
    action: action(requestAction),
    resource,
    context: { boundary: "browser", ...context },
  };
}

function corruptSignature(token: string): string {
  const [header, payload, signature] = token.split(".");
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined
  ) {
    throw new Error("The test token is not a JWT");
  }
  const firstCharacter = signature.startsWith("A") ? "B" : "A";
  return `${header}.${payload}.${firstCharacter}${signature.slice(1)}`;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The P1 test issuer did not expose a TCP port");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function signedDecision(request: object): Promise<boolean> {
  if (cedarling === undefined) throw new Error("Cedarling is not initialized");
  const result = await cedarling.authorizeMultiIssuer(JSON.stringify(request));
  expect(result.response.diagnostics.errors).toEqual([]);
  return result.decision;
}

async function browserDecision(request: object): Promise<boolean> {
  if (cedarling === undefined) throw new Error("Cedarling is not initialized");
  const result = await cedarling.authorizeUnsigned(JSON.stringify(request));
  expect(result.response.diagnostics.errors).toEqual([]);
  return result.decision;
}

beforeAll(async () => {
  issuerServer = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/.well-known/openid-configuration") {
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    if (request.url === "/jwks") {
      response.end(
        JSON.stringify({
          keys: [
            { ...publicJwk, kid: "p1-test-key", use: "sig", alg: "RS256" },
          ],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  issuer = `http://127.0.0.1:${String(await listen(issuerServer))}`;

  temporaryRoot = await mkdtemp(join(tmpdir(), "cedarling-p1-policy-"));
  await cp(policyStoreSource, join(temporaryRoot, "policy-store"), {
    recursive: true,
  });
  const issuerPath = join(
    temporaryRoot,
    "policy-store/trusted-issuers/tutorial-idp.json",
  );
  const issuerConfiguration = JSON.parse(
    await readFile(issuerPath, "utf8"),
  ) as {
    openid_configuration_endpoint: string;
  };
  issuerConfiguration.openid_configuration_endpoint = `${issuer}/.well-known/openid-configuration`;
  await writeFile(
    issuerPath,
    `${JSON.stringify(issuerConfiguration, null, 2)}\n`,
  );
  const archive = await buildPolicyStore({
    projectRoot: temporaryRoot,
    dependencyRoot: projectRoot,
  });
  cedarling = await initFromArchiveBytes(
    {
      CEDARLING_APPLICATION_NAME: "P1 policy-store test",
      CEDARLING_LOG_TYPE: "memory",
      CEDARLING_LOG_TTL: 300,
      CEDARLING_JWT_SIG_VALIDATION: "enabled",
      CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED: ["RS256"],
      CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
      CEDARLING_TRUSTED_ISSUER_LOADER_TYPE: "SYNC",
    },
    new Uint8Array(await readFile(archive.outputPath)),
  );
}, 30_000);

afterAll(async () => {
  if (cedarling !== undefined) {
    await cedarling.shutDown();
  }
  if (issuerServer !== undefined) await close(issuerServer);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("P1 server policy", () => {
  const tenantATask = task(
    "task-a-brief",
    "tenant-a",
    "user-mina",
    "user-alex",
  );
  const mina = userContext("user-mina", "mina", "tenant-a", "owner", 2);
  const alex = userContext("user-alex", "alex", "tenant-a", "contributor", 1);
  const sam = userContext("user-sam", "sam", "tenant-b", "external", 1);
  const tenantBTask = task("task-b-notes", "tenant-b", "user-sam", "user-sam");

  describe.each([
    {
      name: "view an assigned task",
      subject: "alex",
      user: alex,
      action: "View",
      resource: tenantATask,
      scope: "task.view",
    },
    {
      name: "edit an owned task in Sam's tenant",
      subject: "sam",
      user: sam,
      action: "Edit",
      resource: tenantBTask,
      scope: "task.edit",
    },
    {
      name: "create a task as an assured owner",
      subject: "mina",
      user: mina,
      action: "Create",
      resource: tenant("tenant-a"),
      scope: "task.create",
    },
    {
      name: "assign an owned task within its tenant",
      subject: "mina",
      user: mina,
      action: "Assign",
      resource: tenantATask,
      context: { requested_assignee_tenant_id: "tenant-a" },
      scope: "task.assign",
    },
    {
      name: "complete an owned task as an assured owner",
      subject: "mina",
      user: mina,
      action: "Complete",
      resource: tenantATask,
      scope: "task.complete",
    },
    {
      name: "delete an owned task as an assured owner",
      subject: "mina",
      user: mina,
      action: "Delete",
      resource: tenantATask,
      scope: "task.delete",
    },
  ])("$name", (policyCase) => {
    const scope = policyCase.scope;
    const otherScopes = allScopes.filter((candidate) => candidate !== scope);

    test.each([
      { name: "only scope", scopes: [scope] },
      { name: "first scope", scopes: [scope, ...otherScopes] },
      {
        name: "middle scope",
        scopes: [...otherScopes.slice(0, 2), scope, ...otherScopes.slice(2)],
      },
      { name: "last scope", scopes: [...otherScopes, scope] },
    ])("allows the required scope as the $name", async ({ scopes }) => {
      expect(
        await signedDecision(signedRequest({ ...policyCase, scopes })),
      ).toBe(true);
    });

    test.each([
      { name: "empty scope", scopes: [] },
      { name: "missing action scope", scopes: otherScopes },
      { name: "prefixed scope", scopes: [...otherScopes, `not-${scope}`] },
      { name: "suffixed scope", scopes: [`${scope}.extra`, ...otherScopes] },
    ])("denies $name", async ({ scopes }) => {
      expect(
        await signedDecision(signedRequest({ ...policyCase, scopes })),
      ).toBe(false);
    });
  });

  test.each([
    {
      name: "cross-tenant access",
      subject: "sam",
      user: sam,
      action: "View",
      resource: tenantATask,
    },
    {
      name: "same-tenant access without ownership or assignment",
      subject: "alex",
      user: alex,
      action: "View",
      resource: task("task-a-review", "tenant-a", "user-mina", "user-mina"),
    },
    {
      name: "an unqualified role",
      subject: "mina",
      user: userContext("user-mina", "mina", "tenant-a", "contributor", 2),
      action: "Create",
      resource: tenant("tenant-a"),
    },
    {
      name: "insufficient assurance",
      subject: "mina",
      user: userContext("user-mina", "mina", "tenant-a", "owner", 1),
      action: "Create",
      resource: tenant("tenant-a"),
    },
    {
      name: "a user that does not match the signed subject",
      subject: "alex",
      user: mina,
      action: "View",
      resource: tenantATask,
    },
    {
      name: "the wrong token audience",
      subject: "alex",
      user: alex,
      action: "View",
      resource: tenantATask,
      tokenAudience: "http://other.example/api",
    },
    {
      name: "an assignee from another tenant",
      subject: "mina",
      user: mina,
      action: "Assign",
      resource: tenantATask,
      context: { requested_assignee_tenant_id: "tenant-b" },
    },
  ])("denies $name", async (policyCase) => {
    expect(await signedDecision(signedRequest(policyCase))).toBe(false);
  });

  test("fails closed when the signed token has no scope claim", async () => {
    const request = signedRequest({
      subject: "mina",
      user: mina,
      action: "Create",
      resource: tenant("tenant-a"),
    });
    request.tokens[0]!.payload = accessToken("mina", null);

    await expect(signedDecision(request)).rejects.toThrow(/validate tokens/i);
  });

  test("fails closed for an invalid token signature", async () => {
    const request = signedRequest({
      subject: "alex",
      user: alex,
      action: "View",
      resource: tenantATask,
    });
    request.tokens[0]!.payload = corruptSignature(request.tokens[0]!.payload);

    try {
      expect(await signedDecision(request)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/signature|validate tokens/i);
    }
  });

  test("filters server task lists per row and fails malformed rows closed", async () => {
    if (cedarling === undefined)
      throw new Error("Cedarling is not initialized");
    const batch = await cedarling.authorizeMultiIssuerBatch(
      JSON.stringify({
        tokens: tokenSet("alex"),
        items: [
          {
            action: action("View"),
            resource: tenantATask,
            context: { boundary: "server", user: alex },
          },
          {
            action: action("View"),
            resource: tenantBTask,
            context: { boundary: "server", user: alex },
          },
          {
            action: action("View"),
            resource: {
              cedar_entity_mapping: {
                entity_type: "Task::Task",
                id: "malformed",
              },
            },
            context: { boundary: "server", user: alex },
          },
        ],
      }),
    );
    expect(batch.results[0]?.is_ok).toBe(true);
    expect(batch.results[0]?.unwrap().decision).toBe(true);
    expect(batch.results[0]?.unwrap().response.diagnostics.errors).toEqual([]);
    expect(batch.results[1]?.is_ok).toBe(true);
    expect(batch.results[1]?.unwrap().decision).toBe(false);
    expect(batch.results[1]?.unwrap().response.diagnostics.errors).toEqual([]);
    expect(batch.results[2]?.is_ok).toBe(false);
  });
});

describe("P1 browser shadow policy", () => {
  const assignedTask = task(
    "task-a-brief",
    "tenant-a",
    "user-mina",
    "user-alex",
  );
  const alex = principal("user-alex", "tenant-a", "contributor", 1);
  const mina = principal("user-mina", "tenant-a", "owner", 2);
  const sam = principal("user-sam", "tenant-b", "external", 1);
  const tenantBTask = task("task-b-notes", "tenant-b", "user-sam", "user-sam");

  test.each([
    { name: "view", principal: alex, action: "View", resource: assignedTask },
    {
      name: "edit Sam's owned task",
      principal: sam,
      action: "Edit",
      resource: tenantBTask,
    },
    {
      name: "create",
      principal: mina,
      action: "Create",
      resource: tenant("tenant-a"),
    },
    {
      name: "assign",
      principal: mina,
      action: "Assign",
      resource: assignedTask,
      context: { requested_assignee_tenant_id: "tenant-a" },
    },
    {
      name: "complete",
      principal: mina,
      action: "Complete",
      resource: assignedTask,
    },
    {
      name: "delete",
      principal: mina,
      action: "Delete",
      resource: assignedTask,
    },
  ])("allows an eligible user to $name", async (policyCase) => {
    expect(await browserDecision(browserRequest(policyCase))).toBe(true);
  });

  test.each([
    {
      name: "complete work as a contributor",
      request: browserRequest({
        principal: alex,
        action: "Complete",
        resource: assignedTask,
      }),
    },
    {
      name: "view work in another tenant",
      request: browserRequest({
        principal: sam,
        action: "View",
        resource: assignedTask,
      }),
    },
    {
      name: "view unrelated work in the same tenant",
      request: browserRequest({
        principal: alex,
        action: "View",
        resource: task("task-a-review", "tenant-a", "user-mina", "user-mina"),
      }),
    },
    {
      name: "assign work across tenants",
      request: browserRequest({
        principal: mina,
        action: "Assign",
        resource: assignedTask,
        context: { requested_assignee_tenant_id: "tenant-b" },
      }),
    },
  ])("does not expose a control that would $name", async ({ request }) => {
    expect(await browserDecision(request)).toBe(false);
  });

  test("supports per-row list filtering and fails malformed rows closed", async () => {
    if (cedarling === undefined)
      throw new Error("Cedarling is not initialized");
    const batch = await cedarling.authorizeUnsignedBatch(
      JSON.stringify({
        principal: principal("user-alex", "tenant-a", "contributor", 1),
        items: [
          {
            action: action("View"),
            resource: task(
              "task-a-brief",
              "tenant-a",
              "user-mina",
              "user-alex",
            ),
            context: { boundary: "browser" },
          },
          {
            action: action("View"),
            resource: tenantBTask,
            context: { boundary: "browser" },
          },
          {
            action: action("View"),
            resource: {
              cedar_entity_mapping: {
                entity_type: "Task::Task",
                id: "malformed",
              },
            },
            context: { boundary: "browser" },
          },
        ],
      }),
    );
    expect(batch.results[0]?.is_ok).toBe(true);
    expect(batch.results[0]?.unwrap().decision).toBe(true);
    expect(batch.results[0]?.unwrap().response.diagnostics.errors).toEqual([]);
    expect(batch.results[1]?.is_ok).toBe(true);
    expect(batch.results[1]?.unwrap().decision).toBe(false);
    expect(batch.results[1]?.unwrap().response.diagnostics.errors).toEqual([]);
    expect(batch.results[2]?.is_ok).toBe(false);
  });
});

describe("P1 server Cedarling boundary", () => {
  test("authorizes single and batch requests from the built archive", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = await createServerAuthorization({
      projectRoot: temporaryRoot,
      dataDirectory: join(temporaryRoot, "data"),
    });
    const session = {
      user: {
        id: "user-alex",
        issuer,
        subject: "alex",
        name: "Alex Morgan",
        tenantId: "tenant-a",
        role: "contributor" as const,
        assuranceLevel: 1,
      },
      tokens: {
        issuer,
        subject: "alex",
        accessToken: accessToken("alex"),
        accessTokenExpiresAt: Date.now() + 300_000,
        refreshToken: "unused-test-refresh-token",
        refreshTokenExpiresAt: Date.now() + 1_200_000,
        idToken: "unused-test-id-token",
        idTokenExpiresAt: Date.now() + 300_000,
        tokenType: "Bearer",
        scope: allScopes.join(" "),
      },
      csrfToken: "unused-test-csrf-token",
      expiresAt: Date.now() + 1_200_000,
    };
    try {
      expect(
        await runtime.authorize("req_single", session, {
          capability: "task.view",
          task: {
            id: "task-a-brief",
            tenantId: "tenant-a",
            ownerId: "user-mina",
            assigneeId: "user-alex",
            title: "Prepare launch brief",
            description: "",
            status: "in-progress",
            version: 1,
            createdAt: "2026-08-25T00:00:00.000Z",
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
        }),
      ).toBe(true);
      expect(
        await runtime.authorizeBatch("req_batch", session, [
          {
            capability: "task.view",
            task: {
              id: "task-a-brief",
              tenantId: "tenant-a",
              ownerId: "user-mina",
              assigneeId: "user-alex",
              title: "Prepare launch brief",
              description: "",
              status: "in-progress",
              version: 1,
              createdAt: "2026-08-25T00:00:00.000Z",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
          },
          {
            capability: "task.view",
            task: {
              id: "task-b-notes",
              tenantId: "tenant-b",
              ownerId: "user-sam",
              assigneeId: "user-sam",
              title: "Capture partner notes",
              description: "",
              status: "todo",
              version: 1,
              createdAt: "2026-08-25T00:00:00.000Z",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
          },
        ]),
      ).toEqual([true, false]);
      expect(await runtime.artifact(runtime.policy.sha256)).toBeDefined();
      const records = info.mock.calls.map(
        ([value]) => JSON.parse(String(value)) as Record<string, unknown>,
      );
      const contexts = records.filter(
        (record) => record.event === "authorization.context",
      );
      const decisions = records.filter(
        (record) => record.log_kind === "Decision",
      );
      expect(contexts.map((record) => record.requestId)).toEqual([
        "req_single",
        "req_batch",
        "req_batch",
      ]);
      expect(decisions.map((record) => record.decision)).toEqual([
        "ALLOW",
        "ALLOW",
        "DENY",
      ]);
      for (const record of contexts) {
        expect(record.actorId).toBe("user-alex");
        expect(record.capability).toBe("task.view");
        expect(
          decisions.some(
            (decision) => decision.request_id === record.cedarlingRequestId,
          ),
        ).toBe(true);
      }
      expect(decisions[0]?.diagnostics).toMatchObject({
        reason: [expect.anything()],
        errors: [],
      });
      expect(decisions[2]?.diagnostics).toEqual({ reason: [], errors: [] });
      const output = info.mock.calls.map(([value]) => String(value)).join("\n");
      expect(output).toContain('\n  "diagnostics": {');
      expect(output).not.toContain("[Object]");
      expect(output).not.toContain(session.tokens.accessToken);
      expect(output).not.toContain(session.tokens.refreshToken);
      await expect(
        runtime.authorize(
          "req_failed",
          {
            ...session,
            tokens: { ...session.tokens, accessToken: "private-token-marker" },
          },
          { capability: "task.create", tenantId: "tenant-a" },
        ),
      ).rejects.toThrow();
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
        event: "authorization.failed",
        requestId: "req_failed",
        actorId: "user-alex",
        capabilities: ["task.create"],
        category: "authorization_unavailable",
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain(
        "private-token-marker",
      );
    } finally {
      await runtime.close();
      info.mockRestore();
      error.mockRestore();
    }
  });
});
