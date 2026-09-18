import { rmSync } from "node:fs";
import type { AppConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import type { OidcTokens } from "../src/server/oidc.ts";
import { FileService } from "../src/server/service.ts";
import { SafeStorage } from "../src/server/storage.ts";
import { temporaryRoot } from "./temporary-root.ts";

export const testTokens: OidcTokens = {
  issuer: "http://idp.localhost:4000",
  subject: "test",
  accessToken: "access-token",
  accessTokenExpiresAt: Date.now() + 600_000,
  refreshToken: "refresh-token",
  refreshTokenExpiresAt: Date.now() + 600_000,
  idToken: "id-token",
  idTokenExpiresAt: Date.now() + 600_000,
  tokenType: "Bearer",
  scope: "file.access",
};

export function createHarness() {
  const root = temporaryRoot("p8-test-");
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    baseUrl: "http://127.0.0.1",
    dataRoot: root,
    issuer: testTokens.issuer,
    apiResource: "http://p8.localhost:3008/api",
    clientId: "p8-cedarfile",
    clientSecret: "test-secret-value-that-is-at-least-32-bytes",
    sessionEncryptionKey: Buffer.alloc(32, 5),
  };
  const storage = new SafeStorage(root);
  const runtime = new AppDatabase(databasePath(root), config.issuer, storage);
  const database = runtime.resources;
  const sessions = runtime.sessions;
  const service = new FileService(database, storage);
  return {
    root,
    config,
    storage,
    database,
    sessions,
    service,
    user(id: string) {
      const user = sessions.findUserById(id);
      if (!user) throw new Error(`Missing fixture user: ${id}`);
      return user;
    },
    close() {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
