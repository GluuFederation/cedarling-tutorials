import { once } from "node:events";
import type { Server } from "node:http";
import { generateKeyPair, SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth/token-verifier.js";
import { loadGovernanceCatalog } from "../src/catalog/catalog.js";
import { loadConfig } from "../src/config/project-config.js";
import type { PersonaId } from "../src/incidents/types.js";
import type { FakeTrace } from "../src/mcp/trace.js";

export type TestApplication = Readonly<{
  endpoint: string;
  config: ReturnType<typeof loadConfig>;
  traces: FakeTrace[];
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

export async function startTestApplication(
  driftMode = false,
): Promise<TestApplication> {
  const projectRoot = process.cwd();
  const config = loadConfig(
    {
      P3_MCP_RESOURCE: "http://p3.localhost:3003/mcp",
      P3_DRIFT_MODE: String(driftMode),
    },
    projectRoot,
  );
  const catalog = await loadGovernanceCatalog(
    config.accPath,
    config.bindingPath,
  );
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const traces: FakeTrace[] = [];
  const runtime = createApp({
    config,
    catalog,
    tokenVerifier: createTokenVerifier({
      issuer: config.issuer,
      audience: config.mcpResource,
      clientId: config.clientId,
      keySet: async () => publicKey,
    }),
    traceSink: (trace) => traces.push(trace),
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
    traces,
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
