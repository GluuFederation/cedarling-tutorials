import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { buildApp } from "../src/server/app.ts";
import type { AppConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import { ExportService } from "../src/server/export-service.ts";
import type {
  OidcIdentity,
  OidcRuntime,
  OidcTokens,
} from "../src/server/oidc.ts";

const now = Date.now();
const tokens = (subject: string): OidcTokens => ({
  issuer: "http://idp.localhost:4000",
  subject,
  accessToken: `access-${subject}`,
  accessTokenExpiresAt: now + 1_800_000,
  refreshToken: `refresh-${subject}`,
  idToken: `id-${subject}`,
  idTokenExpiresAt: now + 1_800_000,
  tokenType: "Bearer",
  scope: "openid profile email data.access",
});

const oidc: OidcRuntime = {
  authorizationUrl(_transaction, loginHint) {
    return Promise.resolve(
      new URL(
        `http://idp.localhost:4000/authorization?login_hint=${loginHint}`,
      ),
    );
  },
  exchange(): Promise<OidcIdentity> {
    return Promise.resolve({
      issuer: "http://idp.localhost:4000",
      subject: "amina",
      tokens: tokens("amina"),
    });
  },
  refresh(current) {
    return Promise.resolve({
      ...current,
      accessTokenExpiresAt: Date.now() + 1_800_000,
    });
  },
};

export type TestSession = Readonly<{
  cookie: string;
  csrf: string;
  analystId: string;
}>;

export type Harness = Readonly<{
  app: Hono;
  config: AppConfig;
  database: AppDatabase;
  exports: ExportService;
  session(persona: "amina" | "leah" | "theo"): TestSession;
  mutation(session: TestSession, body?: unknown): RequestInit;
  close(): void;
}>;

export function createHarness(): Harness {
  const directory = mkdtempSync(path.join(tmpdir(), "p5-test-"));
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3005,
    baseUrl: "http://p5.localhost:3005",
    dataDirectory: directory,
    issuer: "http://idp.localhost:4000",
    apiResource: "http://p5.localhost:3005/api",
    clientId: "p5-dataguard",
    clientSecret: "p5".repeat(16),
    sessionEncryptionKey: Buffer.alloc(32, 7),
  };
  const database = new AppDatabase(
    ":memory:",
    config.issuer,
    path.join(directory, "exports"),
  );
  const exports = new ExportService(database);
  const app = buildApp({ config, database, oidc, exports });
  const sessions = new Map<string, TestSession>();

  return {
    app,
    config,
    database,
    exports,
    session(persona) {
      const existing = sessions.get(persona);
      if (existing) return existing;
      const analyst = database.findAnalyst(config.issuer, persona);
      if (!analyst) throw new Error(`Unknown test persona ${persona}`);
      const created = database.createSession(
        analyst.id,
        tokens(persona),
        config,
      );
      const value = {
        cookie: `p5_session=${created.rawId}`,
        csrf: created.csrfToken,
        analystId: analyst.id,
      };
      sessions.set(persona, value);
      return value;
    },
    mutation(session, body) {
      return {
        method: "POST",
        headers: {
          cookie: session.cookie,
          origin: config.baseUrl,
          "sec-fetch-site": "same-origin",
          "x-csrf-token": session.csrf,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };
    },
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
