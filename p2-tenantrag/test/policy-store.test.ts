import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import {
  createRetrievalAuthorization,
  type RetrievalAuthorization,
} from "../src/authorization.js";
import {
  createAuthenticator,
  type AuthenticatedPrincipal,
} from "../src/auth/authenticator.js";
import { createApp } from "../src/app.js";
import { createCorpusArtifact, createCorpusSearch } from "../src/rag/corpus.js";
import { createRetrievalService } from "../src/rag/retrieval.js";
import { P2_API_RESOURCE, P2_ISSUER } from "../src/config/project-config.js";
import { accessProfiles, fixtureDefinitions } from "../src/rag/fixtures.js";
import { FixtureRepository, type Corpus } from "../src/rag/repository.js";
import type {
  DocumentMetadata,
  FixtureChunk,
  PersonaId,
  RetrievalResponse,
} from "../src/rag/types.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const policyStoreSource = join(projectRoot, "policy-store");
const audience = P2_API_RESOURCE;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: "jwk" });

const profiles = accessProfiles;
const tenantACorpus = corpus("tenant-a-support");
const tenantBCorpus = corpus("tenant-b-support");
const documents = {
  tenantAPublic: document("a-public"),
  tenantAConfidential: document("a-confidential"),
  tenantBPublic: document("b-public"),
  tenantBConfidential: document("b-confidential"),
} as const;

let authorization: RetrievalAuthorization | undefined;
let issuer = "";
let issuerServer: Server | undefined;
let temporaryRoot = "";

function fixture(documentId: string) {
  const definition = fixtureDefinitions.find(
    (candidate) => candidate.documentId === documentId,
  );
  if (definition === undefined)
    throw new Error(`Unknown fixture ${documentId}`);
  return definition;
}

function corpus(corpusId: string): Corpus {
  const definition = fixtureDefinitions.find(
    (candidate) => candidate.corpusId === corpusId,
  );
  if (definition === undefined) throw new Error(`Unknown corpus ${corpusId}`);
  return { corpusId, tenantId: definition.tenantId };
}

function document(documentId: string): DocumentMetadata {
  const definition = fixture(documentId);
  return {
    documentId: definition.documentId,
    title: definition.title,
    corpusId: definition.corpusId,
    tenantId: definition.tenantId,
    classification: definition.classification,
    confidentialReaderSubjects: definition.confidentialReaderSubjects,
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken(
  subject: PersonaId,
  scopes: readonly string[] | null,
  tokenAudience = audience,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", kid: "p2-test-key", typ: "at+jwt" });
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

function principal(
  subject: PersonaId,
  scopes: readonly string[],
  tokenAudience = audience,
): AuthenticatedPrincipal {
  return {
    id: subject,
    accessToken: accessToken(subject, scopes, tokenAudience),
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
    throw new Error("The P2 test issuer did not expose a TCP port");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function runtime(): RetrievalAuthorization {
  if (authorization === undefined) {
    throw new Error("P2 authorization is not initialized");
  }
  return authorization;
}

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
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
            { ...publicJwk, kid: "p2-test-key", use: "sig", alg: "RS256" },
          ],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  issuer = `http://127.0.0.1:${String(await listen(issuerServer))}`;

  temporaryRoot = await mkdtemp(join(tmpdir(), "cedarling-p2-policy-"));
  await cp(policyStoreSource, join(temporaryRoot, "policy-store"), {
    recursive: true,
  });
  const issuerPath = join(
    temporaryRoot,
    "policy-store/trusted-issuers/tutorial-idp.json",
  );
  const issuerConfiguration = JSON.parse(
    await readFile(issuerPath, "utf8"),
  ) as { openid_configuration_endpoint: string };
  issuerConfiguration.openid_configuration_endpoint = `${issuer}/.well-known/openid-configuration`;
  await writeFile(
    issuerPath,
    `${JSON.stringify(issuerConfiguration, null, 2)}\n`,
  );
  const first = await buildPolicyStore({
    projectRoot: temporaryRoot,
    dependencyRoot: projectRoot,
  });
  const firstArchive = await readFile(first.outputPath);
  const second = await buildPolicyStore({
    projectRoot: temporaryRoot,
    dependencyRoot: projectRoot,
  });
  expect(second.sha256).toBe(first.sha256);
  expect(await readFile(second.outputPath)).toEqual(firstArchive);
  authorization = await createRetrievalAuthorization(second.outputPath);
}, 30_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (authorization !== undefined) await authorization.close();
  if (issuerServer?.listening) await close(issuerServer);
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("P2 corpus policy", () => {
  test("rejects a token without the required OAuth scope claim", async () => {
    const caller = {
      id: "ada",
      accessToken: accessToken("ada", null),
    } as const;
    await expect(
      runtime().authorizeCorpus(
        "req_missing_scope",
        caller,
        profiles.ada,
        tenantACorpus,
      ),
    ).rejects.toThrow("Could not validate tokens.");
    await expect(
      runtime().authorizeDocuments(
        "req_missing_scope",
        caller,
        profiles.ada,
        tenantACorpus,
        [document("a-public")],
      ),
    ).rejects.toThrow("Could not validate tokens.");
  });

  test.each([
    ["corpus.search", "document.retrieve"],
    ["document.retrieve", "corpus.search"],
    ["openid", "corpus.search", "document.retrieve", "profile"],
  ])("accepts space-delimited granted scopes: %j", async (...scopes) => {
    const caller = principal("ada", scopes);
    await expect(
      runtime().authorizeCorpus(
        "req_scopes",
        caller,
        profiles.ada,
        tenantACorpus,
      ),
    ).resolves.toBe(true);
    await expect(
      runtime().authorizeDocuments(
        "req_scopes",
        caller,
        profiles.ada,
        tenantACorpus,
        [document("a-public")],
      ),
    ).resolves.toEqual([true]);
  });

  test.each([[], ["not-corpus.search", "document.retrieve.extra"]])(
    "rejects absent or partial scopes: %j",
    async (...scopes) => {
      const caller = principal("ada", scopes);
      await expect(
        runtime().authorizeCorpus(
          "req_scopes",
          caller,
          profiles.ada,
          tenantACorpus,
        ),
      ).resolves.toBe(false);
      await expect(
        runtime().authorizeDocuments(
          "req_scopes",
          caller,
          profiles.ada,
          tenantACorpus,
          [document("a-public")],
        ),
      ).resolves.toEqual([false]);
    },
  );

  test.each([
    ["ada", tenantACorpus],
    ["leo", tenantACorpus],
    ["mallory", tenantBCorpus],
  ] as const)(
    "allows %s to search their tenant corpus",
    async (subject, corpus) => {
      await expect(
        runtime().authorizeCorpus(
          `req_${subject}`,
          principal(subject, ["corpus.search"]),
          profiles[subject],
          corpus,
        ),
      ).resolves.toBe(true);
    },
  );

  test.each([
    ["mallory", tenantACorpus],
    ["leo", tenantBCorpus],
  ] as const)(
    "denies %s a cross-tenant corpus",
    async (subject, targetCorpus) => {
      await expect(
        runtime().authorizeCorpus(
          "req_cross_tenant",
          principal(subject, ["corpus.search"]),
          profiles[subject],
          targetCorpus,
        ),
      ).resolves.toBe(false);
    },
  );

  test.each([
    [["document.retrieve"], audience],
    [["corpus.search"], "http://wrong.example/api"],
  ] as const)(
    "denies invalid token authority",
    async (scopes, tokenAudience) => {
      await expect(
        runtime().authorizeCorpus(
          "req_token_authority",
          principal("ada", scopes, tokenAudience),
          profiles.ada,
          tenantACorpus,
        ),
      ).resolves.toBe(false);
    },
  );
});

describe("P2 HTTP authorization chain", () => {
  test.each(["ada", "leo", "mallory"] as const)(
    "enforces %s's real signed-token permissions before provider disclosure",
    async (subject) => {
      const documents = fixtureDefinitions.map(({ documentId, corpusId }) => ({
        metadata: document(documentId),
        chunks: [
          {
            documentId,
            corpusId,
            chunkId: `${documentId}-1`,
            text: `Synthetic protected content: ${documentId}`,
          },
        ],
      }));
      const repository = new FixtureRepository(documents);
      const vector = Array.from({ length: 256 }, (_, index) =>
        index === 0 ? 1 : 0,
      );
      const voyage = {
        embed: vi.fn(async (inputs: readonly string[]) =>
          inputs.map(() => vector),
        ),
      };
      const generate = vi.fn(
        async (_query: string, _chunks: readonly FixtureChunk[]) => ({
          answer: "Test answer",
          model: "test-model",
        }),
      );
      const artifact = await createCorpusArtifact(
        documents,
        voyage,
        "test-embedding",
      );
      voyage.embed.mockClear();
      const app = createApp({
        authenticator: createAuthenticator({ issuer, audience }),
        retrievalService: createRetrievalService({
          repository,
          corpusSearch: await createCorpusSearch(artifact),
          voyage,
          openRouter: { generate },
          authorization: runtime(),
        }),
        close: async () => {},
      });
      const token = accessToken(subject, [
        "corpus.search",
        "document.retrieve",
      ]);
      try {
        const response = await app.inject({
          method: "POST",
          url: "/v1/retrievals",
          headers: { authorization: `Bearer ${token}` },
          payload: {
            corpusId: "tenant-a-support",
            query: "Find isolation guidance",
            limit: 3,
          },
        });
        if (subject === "mallory") {
          expect(response.statusCode).toBe(404);
          expect(voyage.embed).not.toHaveBeenCalled();
          expect(generate).not.toHaveBeenCalled();
        } else {
          expect(response.statusCode).toBe(200);
          const expected =
            subject === "ada"
              ? ["a-confidential", "a-instruction-like", "a-public"]
              : ["a-instruction-like", "a-public"];
          expect(
            response
              .json<RetrievalResponse>()
              .citations.map(({ documentId }) => documentId)
              .sort(),
          ).toEqual(expected);
          expect(generate).toHaveBeenCalledOnce();
          expect(
            generate.mock.calls[0]?.[1]
              .map(({ documentId }) => documentId)
              .sort(),
          ).toEqual(expected);
        }
        const output = JSON.stringify(vi.mocked(console.info).mock.calls);
        expect(output).not.toContain(token);
        expect(output).not.toContain(token.split(".").slice(0, 2).join("."));
        expect(output).not.toContain("Synthetic protected content:");
        const records = vi
          .mocked(console.info)
          .mock.calls.map(([value]) => String(value))
          .filter((value) => value.startsWith("{"))
          .map((value) => JSON.parse(value) as Record<string, unknown>);
        const contexts = records.filter(
          (record) =>
            record.event === "authorization.context" &&
            record.actorId === subject,
        );
        expect(contexts.length).toBeGreaterThan(0);
        for (const context of contexts) {
          expect(context.requestId).toEqual(expect.any(String));
          expect(
            records.some(
              (record) =>
                record.log_kind === "Decision" &&
                record.request_id === context.cedarlingRequestId,
            ),
          ).toBe(true);
        }
        expect(
          records.some(
            (record) =>
              record.log_kind === "Decision" &&
              record.diagnostics !== undefined,
          ),
        ).toBe(true);
      } finally {
        await app.close();
      }
    },
  );
});

describe("P2 policy trust", () => {
  test("keeps the source issuer and audience aligned with application configuration", async () => {
    const trustedIssuer = JSON.parse(
      await readFile(
        join(policyStoreSource, "trusted-issuers/tutorial-idp.json"),
        "utf8",
      ),
    ) as { openid_configuration_endpoint: string };
    expect(trustedIssuer.openid_configuration_endpoint).toBe(
      `${P2_ISSUER}/.well-known/openid-configuration`,
    );
    await expect(
      readFile(join(policyStoreSource, "policies/server-access.cedar"), "utf8"),
    ).resolves.toContain(P2_API_RESOURCE);
  });

  test("reports the policy identity loaded by the authorization boundary", () => {
    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(/^P2 Cedarling policy .+ \| sha256 [a-f0-9]{64}$/),
    );
  });

  test("denies a token whose signed subject differs from the current principal", async () => {
    const ada = principal("ada", ["corpus.search"]);
    await expect(
      runtime().authorizeCorpus(
        "req_subject_mismatch",
        { ...ada, id: "leo" },
        profiles.leo,
        tenantACorpus,
      ),
    ).resolves.toBe(false);
  });

  test("rejects a token with an invalid signature", async () => {
    const ada = principal("ada", ["corpus.search"]);
    await expect(
      runtime().authorizeCorpus(
        "req_invalid_signature",
        { ...ada, accessToken: corruptSignature(ada.accessToken) },
        profiles.ada,
        tenantACorpus,
      ),
    ).rejects.toThrow();
  });
});

describe("P2 document policy", () => {
  test("allows Ada both public and explicitly granted Tenant A evidence", async () => {
    await expect(
      runtime().authorizeDocuments(
        "req_ada_documents",
        principal("ada", ["document.retrieve"]),
        profiles.ada,
        tenantACorpus,
        [documents.tenantAPublic, documents.tenantAConfidential],
      ),
    ).resolves.toEqual([true, true]);
  });

  test("allows Leo public evidence but denies confidential evidence", async () => {
    await expect(
      runtime().authorizeDocuments(
        "req_leo_documents",
        principal("leo", ["document.retrieve"]),
        profiles.leo,
        tenantACorpus,
        [documents.tenantAPublic, documents.tenantAConfidential],
      ),
    ).resolves.toEqual([true, false]);
  });

  test("allows Mallory public Tenant B evidence but denies ungranted confidential evidence", async () => {
    await expect(
      runtime().authorizeDocuments(
        "req_mallory_documents",
        principal("mallory", ["document.retrieve"]),
        profiles.mallory,
        tenantBCorpus,
        [documents.tenantBPublic, documents.tenantBConfidential],
      ),
    ).resolves.toEqual([true, false]);
  });

  test("denies same-tenant evidence without the retrieval scope", async () => {
    await expect(
      runtime().authorizeDocuments(
        "req_missing_scope",
        principal("ada", ["corpus.search"]),
        profiles.ada,
        tenantACorpus,
        [documents.tenantAPublic],
      ),
    ).resolves.toEqual([false]);
  });

  test("denies a cross-tenant document even when it is public", async () => {
    await expect(
      runtime().authorizeDocuments(
        "req_cross_tenant_document",
        principal("mallory", ["document.retrieve"]),
        profiles.mallory,
        tenantACorpus,
        [documents.tenantAPublic],
      ),
    ).resolves.toEqual([false]);
  });
});
