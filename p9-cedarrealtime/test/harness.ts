import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthorizationGateway } from "../src/server/authorization.ts";
import type { AppConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import type { OidcTokens } from "../src/server/oidc.ts";
import { SessionStore } from "../src/server/session-store.ts";

export const testTokens: OidcTokens = {
  issuer: "http://idp.localhost:4000",
  subject: "test",
  accessToken: "test-access-token",
  accessTokenExpiresAt: Date.now() + 600_000,
  refreshToken: "test-refresh-token",
  refreshTokenExpiresAt: Date.now() + 600_000,
  idToken: "test-id-token",
  idTokenExpiresAt: Date.now() + 600_000,
  tokenType: "Bearer",
  scope: "openid profile offline_access chat.access",
};

export function createHarness(
  mode: "permissive" | "unavailable" = "permissive",
) {
  const root = mkdtempSync(path.join(tmpdir(), "p9-test-"));
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    baseUrl: "http://127.0.0.1",
    dataRoot: root,
    issuer: testTokens.issuer,
    apiResource: "http://p9.localhost:3009/api",
    clientId: "p9-cedarrealtime",
    clientSecret: "test-secret-value-that-is-at-least-32-bytes",
    sessionEncryptionKey: Buffer.alloc(32, 9),
  };
  const database = new AppDatabase(databasePath(root), config.issuer);
  const sessions = new SessionStore(database.connection);
  const authorization = new AuthorizationGateway(() => mode === "permissive");
  return {
    root,
    config,
    database,
    sessions,
    authorization,
    session(userId: string, subject = userId.replace(/^user-/u, "")) {
      return sessions.createSession(userId, { ...testTokens, subject }, config);
    },
    close() {
      if (database.connection.open) database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
