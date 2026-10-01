import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Sqlite from "better-sqlite3";
import type { Hono } from "hono";
import { buildApp } from "../src/server/app.ts";
import {
  createDataAuthorization,
  type DataAuthorization,
} from "../src/server/authorization.ts";
import type { AppConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import { ExportService } from "../src/server/export-service.ts";
import type {
  OidcIdentity,
  OidcRuntime,
  OidcTokens,
} from "../src/server/oidc.ts";

const tokens = (subject: string): OidcTokens => ({
  issuer: "http://localhost:18005",
  subject,
  accessToken: `access-${subject}`,
  accessTokenExpiresAt: Date.now() + 1_800_000,
  refreshToken: `refresh-${subject}`,
  idToken: `id-${subject}`,
  idTokenExpiresAt: Date.now() + 1_800_000,
  tokenType: "Bearer",
  scope: "openid profile email data.access",
});

const oidc: OidcRuntime = {
  authorizationUrl(_transaction, loginHint) {
    return Promise.resolve(
      new URL(`http://localhost:18005/authorization?login_hint=${loginHint}`),
    );
  },
  exchange(): Promise<OidcIdentity> {
    return Promise.resolve({
      issuer: "http://localhost:18005",
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
}>;

export type Harness = Readonly<{
  app: Hono;
  config: AppConfig;
  database: AppDatabase;
  exports: ExportService;
  authorization: DataAuthorization;
  sql: Sqlite.Database;
  directory: string;
  session(persona: "amina" | "leah" | "theo"): TestSession;
  mutation(session: TestSession, body?: unknown): RequestInit;
  close(): Promise<void>;
}>;

export async function createHarness(): Promise<Harness> {
  const directory = mkdtempSync(path.join(tmpdir(), "p5-test-"));
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 17005,
    baseUrl: "http://localhost:17005",
    dataDirectory: directory,
    issuer: "http://localhost:18005",
    apiResource: "http://localhost:17005/api",
    clientId: "p5-dataguard",
    clientSecret: "p5".repeat(16),
    sessionEncryptionKey: Buffer.alloc(32, 7),
  };
  const database = new AppDatabase(
    path.join(directory, "p5.sqlite"),
    config.issuer,
    path.join(directory, "exports"),
  );
  const exports = new ExportService(database);
  const authorization = await createDataAuthorization();
  const sql = new Sqlite(path.join(directory, "p5.sqlite"));
  const app = buildApp({ config, database, oidc, exports, authorization });
  const sessions = new Map<string, TestSession>();

  return {
    app,
    config,
    database,
    exports,
    authorization,
    sql,
    directory,
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
    async close() {
      try {
        await authorization.close();
      } finally {
        sql.close();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
