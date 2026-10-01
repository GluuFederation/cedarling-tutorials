import { once } from "node:events";
import type { Server } from "node:http";
import { generateKeyPair, SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth/token-verifier.js";
import { IncidentRepository } from "../src/incidents/repository.js";
import { loadConfig } from "../src/config/project-config.js";
import type { PersonaId } from "../src/incidents/types.js";
import type { authorize, Action, Resource } from "../src/mcp/authorization.js";

export type TestApplication = Readonly<{
  endpoint: string;
  config: ReturnType<typeof loadConfig>;
  calls: { action: Action; resource: Resource }[];
  incidents: IncidentRepository;
  token: (
    persona: PersonaId,
    overrides?: Readonly<{
      issuer?: string;
      audience?: string;
      clientId?: string;
      expiresInSeconds?: number;
      scope?: string;
      subject?: string;
    }>,
  ) => Promise<string>;
  close: () => Promise<void>;
}>;

/** Exercises MCP routing with an explicit decision stub; real Cedarling is covered by test:e2e. */
export async function startTestApplication(
  decide: typeof authorize = async () => true,
): Promise<TestApplication> {
  const config = loadConfig({});
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const calls: { action: Action; resource: Resource }[] = [];
  const incidents = new IncidentRepository();
  const runtime = createApp({
    config,
    incidents,
    tokenVerifier: createTokenVerifier({
      issuer: config.issuer,
      audience: config.mcpResource,
      clientId: config.clientId,
      keySet: async () => publicKey,
    }),
    authorize: async (auth, action, resource, requestId) => {
      calls.push({ action, resource });
      return decide(auth, action, resource, requestId);
    },
  });
  const listener: Server = runtime.app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    config,
    calls,
    incidents,
    async token(persona, overrides = {}) {
      const now = Math.floor(Date.now() / 1_000);
      return new SignJWT({
        scope: overrides.scope ?? "openid profile email mcp.access",
        client_id: overrides.clientId ?? config.clientId,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(overrides.issuer ?? config.issuer)
        .setAudience(overrides.audience ?? config.mcpResource)
        .setSubject(overrides.subject ?? persona)
        .setIssuedAt(now)
        .setExpirationTime(now + (overrides.expiresInSeconds ?? 1_800))
        .sign(privateKey);
    },
    async close() {
      await runtime.close();
      listener.close();
      await once(listener, "close");
    },
  };
}
